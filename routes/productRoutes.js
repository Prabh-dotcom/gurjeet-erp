const express = require("express");
const router = express.Router();

const Product = require("../models/Product");
const Stock = require("../models/Stock");

router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Product Route Working"
    });
});

router.post("/", async (req, res) => {
    try {
        const productData = req.body;

        if (!productData.brand) {
            return res.status(400).json({
                success: false,
                message: "Brand is required"
            });
        }

        if (!productData.category) {
            return res.status(400).json({
                success: false,
                message: "Category is required"
            });
        }

        if (!productData.productName) {
            return res.status(400).json({
                success: false,
                message: "Product name is required"
            });
        }

        if (!productData.model) {
            return res.status(400).json({
                success: false,
                message: "Model is required"
            });
        }

        // Selling price is optional (defaults to 0 in model)

        const product = await Product.create(productData);

        // =================================================
        // AUTO-CREATE MATCHING STOCK ENTRY
        // So the product shows up immediately in Stock
        // Management instead of needing a separate manual
        // step (this is what the Add Product form already
        // promises the user).
        // =================================================

        let stockEntry = null;

        try {

            stockEntry = await Stock.create({
                product: product._id,
                barcode: product.barcode || undefined,
                imei: product.imei || undefined,
                quantity: 1,
                status: "in_stock",
                purchasePrice: 0,
                sellingPrice: Number(product.sellingPrice || 0)
            });

        } catch (stockError) {

            // Product was created successfully either way.
            // We still report the stock issue so the frontend
            // can tell the user (e.g. duplicate IMEI).
            console.error("Auto Stock Create Error:", stockError);

        }

        res.status(201).json({
            success: true,
            message: stockEntry
                ? "Product created and added to Stock successfully"
                : "Product created, but could not auto-add to Stock" +
                  (stockEntry === null && product.imei
                      ? " (possible duplicate IMEI)"
                      : ""),
            data: product,
            stock: stockEntry
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

// =====================================================
// ONE-TIME BACKFILL: create Stock for old products
// Visit this URL once in the browser (while logged in via
// the same browser, since it just needs to hit the server)
// to add a Stock entry for every existing product that
// doesn't have one yet. Safe to run more than once — it
// skips products that already have stock.
// =====================================================

router.get("/backfill-stock", async (req, res) => {
    try {

        const products = await Product.find();

        const created = [];
        const skipped = [];
        const failed = [];

        for (const product of products) {

            const existingStock = await Stock.findOne({
                product: product._id
            });

            if (existingStock) {
                skipped.push(product._id);
                continue;
            }

            try {

                const stock = await Stock.create({
                    product: product._id,
                    barcode: product.barcode || undefined,
                    imei: product.imei || undefined,
                    quantity: 1,
                    status: "in_stock",
                    purchasePrice: 0,
                    sellingPrice: Number(product.sellingPrice || 0)
                });

                created.push(stock._id);

            } catch (err) {
                failed.push({
                    product: product._id,
                    error: err.message
                });
            }

        }

        res.json({
            success: true,
            message: "Backfill complete",
            createdCount: created.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            failed
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Backfill failed",
            error: error.message
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const { brand, category, search, includeSold } = req.query;

        const filter = {};

        if (brand) filter.brand = brand;
        if (category) filter.category = category;

        if (search) {
            filter.$or = [
                {
                    productName: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    model: {
                        $regex: search,
                        $options: "i"
                    }
                },
                {
                    barcode: {
                        $regex: search,
                        $options: "i"
                    }
                }
            ];
        }

        // Hide products whose IMEI is already sold
        if (includeSold !== "true") {

            const soldImeis = await Stock.find({
                status: "sold",
                imei: { $exists: true, $ne: null }
            }).distinct("imei");

            if (soldImeis.length) {
                filter.imei = { $nin: soldImeis };
            }

        }

        const products = await Product.find(filter)
            .populate("brand", "name")
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            count: products.length,
            data: products
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate("brand", "name");

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        res.json({
            success: true,
            data: product
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

router.put("/:id", async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        res.json({
            success: true,
            message: "Product updated successfully",
            data: product
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const product = await Product.findByIdAndDelete(req.params.id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        res.json({
            success: true,
            message: "Product deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });
    }
});

module.exports = router;