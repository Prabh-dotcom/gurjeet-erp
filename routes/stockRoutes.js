const express = require("express");
const router = express.Router();

const Stock = require("../models/Stock");
const SoldProduct = require("../models/SoldProduct");
const Barcode = require("../models/Barcode");
const Product = require("../models/Product");


// =====================================================
// TEST
// =====================================================

router.get("/test", (req, res) => {

    res.json({
        success: true,
        message: "Stock Route Working"
    });

});


// =====================================================
// GET ALL STOCK
// =====================================================

router.get("/", async (req, res) => {

    try {

        const {
            brand,
            category,
            status,
            search,
            includeSold
        } = req.query;

        const filter = {};

        if (status) {

            filter.status = status;

        }

        // Sold items must not appear in stock list (history stays in Sold Products)
        else if (includeSold !== "true") {

            filter.status = { $ne: "sold" };

        }

        if (search) {

            filter.$or = [

                {
                    barcode: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    imei: {
                        $regex: search,
                        $options: "i"
                    }
                },

                {
                    serialNo: {
                        $regex: search,
                        $options: "i"
                    }
                }

            ];

        }


        const stocks = await Stock.find(filter)
            .populate({
                path: "product",
                populate: {
                    path: "brand",
                    select: "name"
                }
            })
            .sort({
                createdAt: -1
            });


        let data = stocks;


        if (brand) {

            data = data.filter(
                item =>
                    item.product &&
                    item.product.brand &&
                    String(
                        item.product.brand._id
                    ) === String(brand)
            );

        }


        if (category) {

            data = data.filter(
                item =>
                    item.product &&
                    item.product.category === category
            );

        }


        res.json({

            success: true,

            count: data.length,

            data

        });


    } catch (error) {

        console.error(
            "Get Stock Error:",
            error
        );

        res.status(500).json({

            success: false,

            message: "Server error",

            error: error.message

        });

    }

});


// =====================================================
// MANUAL SELL STOCK
// =====================================================

router.post("/:id/sell", async (req, res) => {

    try {

        const stock = await Stock.findById(
            req.params.id
        ).populate({

            path: "product",

            populate: {

                path: "brand",

                select: "name"

            }

        });


        if (!stock) {

            return res.status(404).json({

                success: false,

                message: "Stock item not found"

            });

        }


        // =============================================
        // CHECK STOCK
        // =============================================

        if (
            !stock.quantity ||
            Number(stock.quantity) < 1
        ) {

            return res.status(400).json({

                success: false,

                message: "Product is out of stock"

            });

        }


        const {

            customerName,

            customerPhone,

            sellingPrice,

            invoiceNo,

            paymentMethod,

            soldBy

        } = req.body;


        // =============================================
        // VALIDATE SELLING PRICE
        // =============================================

        if (

            sellingPrice === undefined ||

            sellingPrice === "" ||

            Number(sellingPrice) < 0

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Valid selling price is required"

            });

        }


        // =============================================
        // PAYMENT METHOD
        // =============================================

        const allowedPaymentMethods = [

            "cash",

            "upi",

            "card",

            "bank_transfer",

            "other"

        ];


        const finalPaymentMethod =
            paymentMethod || "cash";


        if (
            !allowedPaymentMethods.includes(
                finalPaymentMethod
            )
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid payment method"

            });

        }


        // =============================================
        // CREATE SOLD PRODUCT
        // =============================================

        const soldProduct =
            await SoldProduct.create({

                stockId:
                    stock._id,

                product:
                    stock.product._id,

                barcode:
                    stock.barcode ||
                    `STOCK-${stock._id}`,

                imei:
                    stock.imei,

                serialNo:
                    stock.serialNo,

                soldDate:
                    new Date(),

                soldBy:
                    soldBy || undefined,

                sellingPrice:
                    Number(sellingPrice),

                customerName:
                    customerName || "",

                customerPhone:
                    customerPhone || "",

                invoiceNo:
                    invoiceNo || "",

                paymentMethod:
                    finalPaymentMethod,

                status:
                    "sold"

            });


        // =============================================
        // REDUCE STOCK
        // =============================================

        stock.quantity =
            Number(stock.quantity) - 1;


        // =============================================
        // UPDATE STOCK STATUS
        // =============================================

        /*
            IMPORTANT:
            We use the status values that are
            normally expected by the Stock model.
            If quantity becomes 0 -> out_of_stock
            Otherwise -> in_stock
        */

        if (
            Number(stock.quantity) <= 0
        ) {

            stock.quantity = 0;

            stock.status =
                "out_of_stock";

        } else {

            stock.status =
                "in_stock";

        }


        await stock.save();


        // =============================================
        // UPDATE BARCODE STATUS
        // =============================================

        if (stock.barcode) {

            await Barcode.findOneAndUpdate(

                {
                    barcode:
                        stock.barcode
                },

                {
                    status:
                        "sold"
                }

            );

        }


        // =============================================
        // RESPONSE
        // =============================================

        res.status(201).json({

            success: true,

            message:
                "Product sold successfully",

            data: {

                soldProduct:

                    soldProduct,

                remainingStock:

                    stock.quantity,

                stockStatus:

                    stock.status

            }

        });


    } catch (error) {

        console.error(
            "Sell Stock Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


// =====================================================
// GET STOCK BY ID
// =====================================================

router.get("/:id", async (req, res) => {

    try {

        const stock =
            await Stock.findById(
                req.params.id
            )
            .populate({

                path: "product",

                populate: {

                    path: "brand",

                    select: "name"

                }

            });


        if (!stock) {

            return res.status(404).json({

                success: false,

                message:
                    "Stock item not found"

            });

        }


        res.json({

            success: true,

            data: stock

        });


    } catch (error) {

        console.error(
            "Get Stock By ID Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


// =====================================================
// UPDATE STOCK
// =====================================================

router.put("/:id", async (req, res) => {

    try {

        const stock =
            await Stock.findByIdAndUpdate(

                req.params.id,

                req.body,

                {
                    new: true,
                    runValidators: true
                }

            );


        if (!stock) {

            return res.status(404).json({

                success: false,

                message:
                    "Stock item not found"

            });

        }


        res.json({

            success: true,

            message:
                "Stock updated successfully",

            data:
                stock

        });


    } catch (error) {

        console.error(
            "Update Stock Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


// =====================================================
// DELETE STOCK
// =====================================================

router.delete("/:id", async (req, res) => {

    try {

        const stock =
            await Stock.findByIdAndDelete(
                req.params.id
            );


        if (!stock) {

            return res.status(404).json({

                success: false,

                message:
                    "Stock item not found"

            });

        }


        res.json({

            success: true,

            message:
                "Stock deleted successfully"

        });


    } catch (error) {

        console.error(
            "Delete Stock Error:",
            error
        );


        res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


module.exports = router;

// =====================================================
// ADD STOCK FROM BARCODE SCANNER
// POST /api/stock
// =====================================================

router.post("/", async (req, res) => {
    try {
        const barcode = String(req.body.barcode || "").trim();
        const imei = String(req.body.imei || "").trim();

        if (!barcode) {
            return res.status(400).json({
                success: false,
                message: "Barcode is required"
            });
        }

        // 1. Find product by barcode in Product Master
        let product = await Product.findOne({ barcode });

        // 2. If not found, check Barcode collection
        if (!product) {
            const barcodeRecord = await Barcode.findOne({ barcode });

            if (barcodeRecord && barcodeRecord.product) {
                product = await Product.findById(
                    barcodeRecord.product
                );
            }
        }

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found. Register barcode in Product Master first."
            });
        }

        // 3. Validate IMEI
        if (product.imeiRequired !== false && !imei) {
            return res.status(400).json({
                success: false,
                message: "IMEI is required"
            });
        }

        if (imei && !/^\d{15}$/.test(imei)) {
            return res.status(400).json({
                success: false,
                message: "IMEI must contain exactly 15 digits"
            });
        }

        // 4. Prevent duplicate IMEI
        if (imei) {
            const existingImei = await Stock.findOne({ imei });

            if (existingImei) {
                return res.status(409).json({
                    success: false,
                    message: "This IMEI already exists"
                });
            }
        }

        // 5. Avoid duplicate active stock for non-IMEI products
        if (product.imeiRequired === false) {
            const existingBarcode = await Stock.findOne({
                barcode,
                status: "in_stock",
                quantity: { $gt: 0 }
            });

            if (existingBarcode) {
                return res.status(409).json({
                    success: false,
                    message: "Stock for this barcode already exists"
                });
            }
        }

        // 6. Create stock
        const stock = await Stock.create({
            product: product._id,
            barcode,
            imei: imei || undefined,
            quantity: 1,
            status: "in_stock",
            purchasePrice: 0,
            sellingPrice: Number(product.sellingPrice || 0)
        });

        // 7. Create/update barcode registry
        await Barcode.findOneAndUpdate(
            { barcode },
            {
                $set: {
                    barcode,
                    product: product._id,
                    stock: stock._id,
                    imei: imei || undefined,
                    type: "barcode",
                    status: "available"
                }
            },
            {
                upsert: true,
                new: true,
                runValidators: true
            }
        );

        // 8. Return created stock
        const populatedStock = await Stock.findById(stock._id)
            .populate({
                path: "product",
                populate: {
                    path: "brand",
                    select: "name"
                }
            });

        return res.status(201).json({
            success: true,
            message: "Stock added successfully",
            data: populatedStock
        });

    } catch (error) {
        console.error("Add Stock Error:", error);

        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "Duplicate barcode or IMEI"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Failed to add stock",
            error: error.message
        });
    }
});