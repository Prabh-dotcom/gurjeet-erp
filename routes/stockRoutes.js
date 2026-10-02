const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Stock = require("../models/Stock");
const SoldProduct = require("../models/SoldProduct");
const Barcode = require("../models/Barcode");
const Product = require("../models/Product");


// =====================================================
// HELPERS
// =====================================================

const STOCK_STATUSES = [
    "in_stock",
    "sold",
    "reserved",
    "damaged",
    "returned"
];

const productPopulate = {
    path: "product",
    populate: {
        path: "brand",
        select: "name"
    }
};

const escapeRegex = (value) =>
    String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const validId = (id) => mongoose.isValidObjectId(id);

/*
    Counts are calculated on the WHOLE stock collection (not only on the
    rows returned by the current filter). Because the list hides sold
    items by default, the page used to show "Sold = 0" and wrong totals.
*/
async function getStockSummary() {

    // one accumulator per $group keeps the result identical on every
    // MongoDB-compatible server
    const [rows, quantityRows] = await Promise.all([

        Stock.aggregate([
            {
                $group: {
                    _id: "$status",
                    records: { $sum: 1 }
                }
            }
        ]),

        Stock.aggregate([
            { $match: { status: "in_stock" } },
            {
                $group: {
                    _id: null,
                    quantity: { $sum: "$quantity" }
                }
            }
        ])

    ]);

    const summary = {
        total: 0,
        inStock: 0,
        sold: 0,
        other: 0,
        availableQuantity: quantityRows.length
            ? quantityRows[0].quantity
            : 0
    };

    rows.forEach((row) => {

        summary.total += row.records;

        if (row._id === "in_stock") {

            summary.inStock = row.records;

        } else if (row._id === "sold") {

            summary.sold = row.records;

        } else {

            summary.other += row.records;

        }

    });

    return summary;

}

/*
    Products that exist in Product Master but have no Stock record yet.
    (Old products created before "auto-create stock" was added.)
    These are the reason the Stock page can look completely empty.
*/
async function getMissingStockCount() {

    const stockedProductIds = await Stock.distinct("product");

    return Product.countDocuments({
        _id: { $nin: stockedProductIds }
    });

}


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
                product = await Product.findById(barcodeRecord.product);
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
            .populate(productPopulate);

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


// =====================================================
// GET ALL STOCK
// GET /api/stock?includeSold=true&status=&brand=&category=&search=
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

            filter.status = String(status);

        }

        // Sold items are hidden unless includeSold=true
        // (history stays in Sold Products)
        else if (includeSold !== "true") {

            filter.status = { $ne: "sold" };

        }

        if (search) {

            const escaped = escapeRegex(String(search).trim());

            filter.$or = [
                { barcode: { $regex: escaped, $options: "i" } },
                { imei: { $regex: escaped, $options: "i" } },
                { serialNo: { $regex: escaped, $options: "i" } }
            ];

        }

        const stocks = await Stock.find(filter)
            .populate(productPopulate)
            .sort({ createdAt: -1 });

        let data = stocks;

        if (brand) {

            data = data.filter(
                (item) =>
                    item.product &&
                    item.product.brand &&
                    String(item.product.brand._id) === String(brand)
            );

        }

        if (category) {

            data = data.filter(
                (item) =>
                    item.product &&
                    item.product.category === category
            );

        }

        const [summary, missingStock] = await Promise.all([
            getStockSummary(),
            getMissingStockCount()
        ]);

        res.json({
            success: true,
            count: data.length,
            summary,
            missingStock,
            data
        });

    } catch (error) {

        console.error("Get Stock Error:", error);

        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }

});


// =====================================================
// MANUAL SELL STOCK
// POST /api/stock/:id/sell
// =====================================================

router.post("/:id/sell", async (req, res) => {

    try {

        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid stock ID"
            });
        }

        const stock = await Stock.findById(req.params.id)
            .populate(productPopulate);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        if (!stock.product) {
            return res.status(400).json({
                success: false,
                message: "Product Master record for this stock is missing"
            });
        }

        // CHECK STOCK
        if (
            stock.status === "sold" ||
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

        // VALIDATE SELLING PRICE
        if (
            sellingPrice === undefined ||
            sellingPrice === "" ||
            Number.isNaN(Number(sellingPrice)) ||
            Number(sellingPrice) < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid selling price is required"
            });
        }

        // PAYMENT METHOD
        const allowedPaymentMethods = [
            "cash",
            "upi",
            "card",
            "bank_transfer",
            "other"
        ];

        const finalPaymentMethod = paymentMethod || "cash";

        if (!allowedPaymentMethods.includes(finalPaymentMethod)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method"
            });
        }

        // CREATE SOLD PRODUCT
        const soldProduct = await SoldProduct.create({
            stockId: stock._id,
            product: stock.product._id,
            barcode: stock.barcode || `STOCK-${stock._id}`,
            imei: stock.imei,
            serialNo: stock.serialNo,
            soldDate: new Date(),
            soldBy:
                soldBy && validId(soldBy)
                    ? soldBy
                    : undefined,
            sellingPrice: Number(sellingPrice),
            customerName: customerName || "",
            customerPhone: customerPhone || "",
            invoiceNo: invoiceNo || "",
            paymentMethod: finalPaymentMethod,
            status: "sold"
        });

        // REDUCE STOCK
        /*
            BUG FIX: the old code set status = "out_of_stock", which is NOT
            a valid value in the Stock model enum. stock.save() therefore
            failed with a validation error AFTER the SoldProduct was already
            created, leaving stock and sales out of sync.
            When quantity reaches 0 the item is "sold" (same as
            /api/sold-products and /api/sales).
        */
        stock.quantity = Math.max(Number(stock.quantity) - 1, 0);

        if (stock.quantity === 0) {

            stock.status = "sold";
            stock.soldDate = new Date();

        } else {

            stock.status = "in_stock";

        }

        try {

            await stock.save();

        } catch (saveError) {

            // keep sales + stock consistent
            await SoldProduct.findByIdAndDelete(soldProduct._id);

            throw saveError;

        }

        // UPDATE BARCODE STATUS
        if (stock.barcode && stock.quantity === 0) {

            await Barcode.findOneAndUpdate(
                { barcode: stock.barcode },
                { status: "sold" }
            );

        }

        res.status(201).json({
            success: true,
            message: "Product sold successfully",
            data: {
                soldProduct,
                remainingStock: stock.quantity,
                stockStatus: stock.status
            }
        });

    } catch (error) {

        console.error("Sell Stock Error:", error);

        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }

});


// =====================================================
// GET STOCK BY ID
// =====================================================

router.get("/:id", async (req, res) => {

    try {

        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid stock ID"
            });
        }

        const stock = await Stock.findById(req.params.id)
            .populate(productPopulate);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        res.json({
            success: true,
            data: stock
        });

    } catch (error) {

        console.error("Get Stock By ID Error:", error);

        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }

});


// =====================================================
// UPDATE STOCK
// Only price / quantity / status can be edited
// (product, imei, barcode must not be changed from here)
// =====================================================

router.put("/:id", async (req, res) => {

    try {

        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid stock ID"
            });
        }

        const updates = {};

        for (const field of ["purchasePrice", "sellingPrice"]) {

            const raw = req.body[field];

            if (raw === undefined || raw === "" || raw === null) continue;

            const value = Number(raw);

            if (Number.isNaN(value) || value < 0) {
                return res.status(400).json({
                    success: false,
                    message: `${field} must be a number 0 or more`
                });
            }

            updates[field] = value;

        }

        if (
            req.body.quantity !== undefined &&
            req.body.quantity !== "" &&
            req.body.quantity !== null
        ) {

            const quantity = Number(req.body.quantity);

            if (!Number.isInteger(quantity) || quantity < 0) {
                return res.status(400).json({
                    success: false,
                    message: "Quantity must be a whole number 0 or more"
                });
            }

            updates.quantity = quantity;

        }

        if (req.body.status) {

            if (!STOCK_STATUSES.includes(req.body.status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid stock status"
                });
            }

            updates.status = req.body.status;

        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({
                success: false,
                message: "No valid fields to update"
            });
        }

        const stock = await Stock.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            {
                new: true,
                runValidators: true
            }
        ).populate(productPopulate);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        res.json({
            success: true,
            message: "Stock updated successfully",
            data: stock
        });

    } catch (error) {

        console.error("Update Stock Error:", error);

        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }

});


// =====================================================
// DELETE STOCK
// =====================================================

router.delete("/:id", async (req, res) => {

    try {

        if (!validId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid stock ID"
            });
        }

        const stock = await Stock.findByIdAndDelete(req.params.id);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        res.json({
            success: true,
            message: "Stock deleted successfully"
        });

    } catch (error) {

        console.error("Delete Stock Error:", error);

        res.status(500).json({
            success: false,
            message: "Server error",
            error: error.message
        });

    }

});


module.exports = router;