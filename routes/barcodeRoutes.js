const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Barcode = require("../models/Barcode");
const Product = require("../models/Product");
const Stock = require("../models/Stock");

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validId = (id) => mongoose.isValidObjectId(id);

// -----------------------------------------------------
// TEST
// GET /api/barcode/test
// -----------------------------------------------------

router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Barcode Route Working"
    });
});

// -----------------------------------------------------
// SEARCH PRODUCT BY REGISTERED BARCODE
// GET /api/barcode/search/barcode/:barcode
// -----------------------------------------------------

router.get("/search/barcode/:barcode", async (req, res) => {
    try {
        const barcode = String(req.params.barcode || "").trim();

        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: "Barcode is required"
            });
        }

        const barcodeRecord = await Barcode.findOne({ barcode });

        let product = null;

        if (barcodeRecord?.product) {
            product = await Product.findById(
                barcodeRecord.product
            ).populate("brand", "name");
        }

        // Also allow Product Master barcode mapping.
        if (!product) {
            product = await Product.findOne({
                barcode,
                status: "active"
            }).populate("brand", "name");
        }

        if (!product || product.status !== "active") {
            return res.status(404).json({
                success: false,
                message: "Barcode not registered to an active product"
            });
        }

        if (
            barcodeRecord?.product &&
            String(barcodeRecord.product) !== String(product._id)
        ) {
            return res.status(409).json({
                success: false,
                message: "Barcode product mapping conflict"
            });
        }

        const existingStock = barcodeRecord?.stock
            ? await Stock.findById(barcodeRecord.stock)
            : await Stock.findOne({
                barcode,
                status: { $in: ["in_stock", "reserved"] },
                quantity: { $gt: 0 }
            });

        return res.json({
            success: true,
            message: "Product found",
            data: {
                barcode,
                product: {
                    _id: product._id,
                    brand: product.brand,
                    category: product.category,
                    productName: product.productName,
                    model: product.model,
                    variant: product.variant || "",
                    color: product.color || "",
                    barcode: product.barcode || barcode,
                    imeiRequired: product.imeiRequired !== false,
                    sellingPrice: product.sellingPrice
                },
                existingStock: existingStock || null
            }
        });
    } catch (error) {
        console.error("Barcode Search Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to search barcode",
            error: error.message
        });
    }
});

// -----------------------------------------------------
// SEARCH BY IMEI
// GET /api/barcode/search/imei/:imei
// -----------------------------------------------------

router.get("/search/imei/:imei", async (req, res) => {
    try {
        const imei = String(req.params.imei || "").trim();

        if (!/^\d{15}$/.test(imei)) {
            return res.status(400).json({
                success: false,
                message: "IMEI must contain exactly 15 digits"
            });
        }

        const stock = await Stock.findOne({ imei })
            .populate({
                path: "product",
                populate: {
                    path: "brand",
                    select: "name"
                }
            });

        // Fallback: IMEI registered in Product Master but not yet in Stock
        if (!stock) {
            const masterProduct = await Product.findOne({
                imei,
                status: "active"
            }).populate("brand", "name");

            if (masterProduct) {
                return res.json({
                    success: true,
                    fromProductMaster: true,
                    data: {
                        _id: null,
                        product: masterProduct,
                        imei,
                        barcode: masterProduct.barcode || "",
                        quantity: 1,
                        status: "in_stock",
                        sellingPrice: Number(masterProduct.sellingPrice || 0)
                    }
                });
            }
        }

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "IMEI not found in stock"
            });
        }

        return res.json({
            success: true,
            data: stock
        });
    } catch (error) {
        console.error("IMEI Search Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to search IMEI",
            error: error.message
        });
    }
});

// -----------------------------------------------------
// GET ALL BARCODE RECORDS
// GET /api/barcode?search=&type=&status=
// -----------------------------------------------------

router.get("/", async (req, res) => {
    try {
        const { search, type, status } = req.query;
        const filter = {};

        if (type) {
            if (!["barcode", "imei", "serial"].includes(type)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid barcode type"
                });
            }

            filter.type = type;
        }

        if (status) {
            if (
                ![
                    "available",
                    "sold",
                    "returned",
                    "damaged"
                ].includes(status)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid barcode status"
                });
            }

            filter.status = status;
        }

        if (search) {
            const escaped = escapeRegex(search);

            filter.$or = [
                { barcode: { $regex: escaped, $options: "i" } },
                { imei: { $regex: escaped, $options: "i" } },
                { serialNo: { $regex: escaped, $options: "i" } }
            ];
        }

        const records = await Barcode.find(filter)
            .populate({
                path: "product",
                populate: {
                    path: "brand",
                    select: "name"
                }
            })
            .populate("stock")
            .sort({ createdAt: -1 });

        return res.json({
            success: true,
            count: records.length,
            data: records
        });
    } catch (error) {
        console.error("Get Barcode Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch barcode records",
            error: error.message
        });
    }
});

// -----------------------------------------------------
// GET SINGLE BARCODE RECORD
// GET /api/barcode/:id
// -----------------------------------------------------

router.get("/:id", async (req, res) => {
    try {
        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid barcode record ID"
            });
        }

        const record = await Barcode.findById(req.params.id)
            .populate({
                path: "product",
                populate: {
                    path: "brand",
                    select: "name"
                }
            })
            .populate("stock");

        if (!record) {
            return res.status(404).json({
                success: false,
                message: "Barcode record not found"
            });
        }

        return res.json({
            success: true,
            data: record
        });
    } catch (error) {
        console.error("Get Barcode Record Error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch barcode record",
            error: error.message
        });
    }
});

module.exports = router;