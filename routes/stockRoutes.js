const express = require("express");
const router = express.Router();

const Stock = require("../models/Stock");
const SoldProduct = require("../models/SoldProduct");
const Barcode = require("../models/Barcode");
const Product = require("../models/Product");

const productPopulate = {
    path: "product",
    populate: {
        path: "brand",
        select: "name"
    }
};

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
// GET /api/stock?includeSold=true&status=&brand=&category=&search=
// =====================================================

router.get("/", async (req, res) => {
    try {
        const { brand, category, status, search, includeSold } = req.query;

        const filter = {};

        if (status) {
            filter.status = status;
        } else if (includeSold !== "true") {
            // Sold items hidden unless includeSold=true
            filter.status = { $ne: "sold" };
        }

        if (search) {
            filter.$or = [
                { barcode: { $regex: search, $options: "i" } },
                { imei: { $regex: search, $options: "i" } },
                { serialNo: { $regex: search, $options: "i" } }
            ];
        }

        const stocks = await Stock.find(filter)
            .populate(productPopulate)
            .sort({ createdAt: -1 });

        // FIX: Stock.sellingPrice was saved as 0 for most records
        // (Product Master form has no price field). Fall back to the
        // Product Master price so the page does not show Rs.0.
        let data = stocks.map(item => {
            const obj = item.toObject();
            const product = obj.product || {};

            if (
                !Number(obj.sellingPrice) &&
                Number(product.sellingPrice)
            ) {
                obj.sellingPrice = Number(product.sellingPrice);
            }

            return obj;
        });

        if (brand) {
            data = data.filter(
                item =>
                    item.product &&
                    item.product.brand &&
                    String(item.product.brand._id) === String(brand)
            );
        }

        if (category) {
            data = data.filter(
                item =>
                    item.product &&
                    item.product.category === category
            );
        }

        // FIX: summary cards were calculated on the filtered list
        // (which never contains sold items), so "Sold" was always 0.
        // Calculate them from the whole collection instead.
        const grouped = await Stock.aggregate([
            {
                $group: {
                    _id: "$status",
                    records: { $sum: 1 },
                    quantity: { $sum: "$quantity" }
                }
            }
        ]);

        const summary = {
            total: 0,
            inStock: 0,
            sold: 0,
            other: 0,
            availableQuantity: 0
        };

        grouped.forEach(row => {
            summary.total += row.records;

            if (row._id === "in_stock") {
                summary.inStock += row.records;
                summary.availableQuantity += row.quantity;
            } else if (row._id === "sold") {
                summary.sold += row.records;
            } else {
                summary.other += row.records;
            }
        });

        res.json({
            success: true,
            count: data.length,
            summary,
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
// ADD STOCK FROM BARCODE SCANNER
// POST /api/stock
// =====================================================

router.post("/", async (req, res) => {
    try {
        const barcode = String(req.body.barcode || "").trim();
        const imei = String(req.body.imei || "").trim();
        const productId = req.body.product;

        let quantity = Number(req.body.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) {
            quantity = 1;
        }

        if (!barcode && !productId) {
            return res.status(400).json({
                success: false,
                message: "Barcode is required"
            });
        }

        // 1. FIX: barcode.html already sends the product id.
        //    Use it first instead of only searching by barcode
        //    (Product Master has no barcode field, so that lookup
        //    failed and nothing was added to stock).
        let product = null;

        if (productId) {
            product = await Product.findById(productId);
        }

        // 2. Product Master by barcode
        if (!product && barcode) {
            product = await Product.findOne({ barcode });
        }

        // 3. Barcode registry
        if (!product && barcode) {
            const barcodeRecord = await Barcode.findOne({ barcode });

            if (barcodeRecord && barcodeRecord.product) {
                product = await Product.findById(barcodeRecord.product);
            }
        }

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found. Register it in Product Master first."
            });
        }

        // 4. Validate IMEI
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

        // 5. Prevent duplicate IMEI
        if (imei) {
            const existingImei = await Stock.findOne({ imei });

            if (existingImei) {
                return res.status(409).json({
                    success: false,
                    message: "This IMEI already exists"
                });
            }
        }

        // 6. Non-IMEI products: add to existing quantity instead of rejecting
        if (product.imeiRequired === false) {
            const existing = await Stock.findOne({
                product: product._id,
                imei: { $exists: false },
                status: "in_stock"
            });

            if (existing) {
                existing.quantity = Number(existing.quantity || 0) + quantity;
                await existing.save();

                const populatedExisting = await Stock.findById(existing._id)
                    .populate(productPopulate);

                return res.status(200).json({
                    success: true,
                    message: "Stock quantity updated",
                    data: populatedExisting
                });
            }
        }

        // 7. Create stock
        const stock = await Stock.create({
            product: product._id,
            barcode: barcode || product.barcode || undefined,
            imei: imei || undefined,
            quantity: imei ? 1 : quantity,
            status: "in_stock",
            purchasePrice: Number(req.body.purchasePrice || 0),
            sellingPrice: Number(
                req.body.sellingPrice || product.sellingPrice || 0
            )
        });

        // 8. Barcode registry
        if (barcode) {
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
        }

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
// MANUAL SELL STOCK
// =====================================================

router.post("/:id/sell", async (req, res) => {
    try {
        const stock = await Stock.findById(req.params.id)
            .populate(productPopulate);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        if (!stock.quantity || Number(stock.quantity) < 1) {
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

        if (
            sellingPrice === undefined ||
            sellingPrice === "" ||
            Number(sellingPrice) < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid selling price is required"
            });
        }

        const allowedPaymentMethods = [
            "cash", "upi", "card", "bank_transfer", "other"
        ];

        const finalPaymentMethod = paymentMethod || "cash";

        if (!allowedPaymentMethods.includes(finalPaymentMethod)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method"
            });
        }

        const soldProduct = await SoldProduct.create({
            stockId: stock._id,
            product: stock.product._id,
            barcode: stock.barcode || `STOCK-${stock._id}`,
            imei: stock.imei,
            serialNo: stock.serialNo,
            soldDate: new Date(),
            soldBy: soldBy || undefined,
            sellingPrice: Number(sellingPrice),
            customerName: customerName || "",
            customerPhone: customerPhone || "",
            invoiceNo: invoiceNo || "",
            paymentMethod: finalPaymentMethod,
            status: "sold"
        });

        stock.quantity = Number(stock.quantity) - 1;

        // FIX: "out_of_stock" is NOT in the Stock model enum, so
        // stock.save() threw a validation error. Use "sold" like the
        // other sale routes do.
        if (stock.quantity <= 0) {
            stock.quantity = 0;
            stock.status = "sold";
            stock.soldDate = new Date();
        } else {
            stock.status = "in_stock";
        }

        await stock.save();

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
        const stock = await Stock.findById(req.params.id)
            .populate(productPopulate);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        const obj = stock.toObject();
        const product = obj.product || {};

        if (!Number(obj.sellingPrice) && Number(product.sellingPrice)) {
            obj.sellingPrice = Number(product.sellingPrice);
        }

        res.json({
            success: true,
            data: obj
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
// UPDATE STOCK (quantity / prices / status)
// =====================================================

router.put("/:id", async (req, res) => {
    try {
        const stock = await Stock.findById(req.params.id);

        if (!stock) {
            return res.status(404).json({
                success: false,
                message: "Stock item not found"
            });
        }

        const numericFields = ["quantity", "purchasePrice", "sellingPrice"];

        for (const field of numericFields) {
            if (req.body[field] === undefined || req.body[field] === "") {
                continue;
            }

            const value = Number(req.body[field]);

            if (!Number.isFinite(value) || value < 0) {
                return res.status(400).json({
                    success: false,
                    message: `${field} must be a valid number (0 or more)`
                });
            }

            stock[field] = value;
        }

        ["serialNo", "barcode"].forEach(field => {
            if (req.body[field] !== undefined) {
                stock[field] = String(req.body[field]).trim() || undefined;
            }
        });

        if (req.body.status !== undefined) {
            stock.status = req.body.status;
        } else if (req.body.quantity !== undefined) {
            // keep status in sync with quantity
            if (stock.quantity <= 0) {
                stock.status = "sold";
            } else if (stock.status === "sold") {
                stock.status = "in_stock";
            }
        }

        await stock.save();

        const updated = await Stock.findById(stock._id)
            .populate(productPopulate);

        res.json({
            success: true,
            message: "Stock updated successfully",
            data: updated
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