const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

const Stock = require("../models/Stock");
const SoldProduct = require("../models/SoldProduct");
const Product = require("../models/Product");


// =====================================================
// TEST ROUTE
// =====================================================

router.get("/test", (req, res) => {

    res.json({
        success: true,
        message: "Sold Product Route Working"
    });

});


// =====================================================
// SELL PRODUCT
// IMEI / BARCODE / STOCK ID
// =====================================================

router.post("/", async (req, res) => {

    try {

        const {
            stockId,
            imei,
            barcode,
            soldPrice,
            sellingPrice,
            customerName,
            customerPhone,
            invoiceNo,
            paymentMethod,
            soldBy
        } = req.body;


        // =================================================
        // VALIDATION
        // =================================================

        if (
            !stockId &&
            !imei &&
            !barcode
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "IMEI is required"
            });

        }


        // =================================================
        // FIND STOCK
        // =================================================

        let stock = null;


        if (stockId) {

            if (
                !mongoose.isValidObjectId(stockId)
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid stock ID"
                });

            }


            stock =
                await Stock.findById(stockId);

        }

        else if (imei) {

            stock =
                await Stock.findOne({
                    imei: imei.trim()
                });

        }

        else if (barcode) {

            stock =
                await Stock.findOne({
                    barcode: barcode.trim()
                });

        }


        // =================================================
        // IMEI IN PRODUCT MASTER BUT NOT YET IN STOCK
        // -> create the stock entry automatically
        // =================================================

        if (!stock && imei) {

            const cleanImei = String(imei).trim();

            const masterProduct = await Product.findOne({
                imei: cleanImei,
                status: "active"
            });

            if (masterProduct) {

                stock = await Stock.create({
                    product: masterProduct._id,
                    barcode: masterProduct.barcode || `IMEI-${cleanImei}`,
                    imei: cleanImei,
                    quantity: 1,
                    status: "in_stock",
                    purchasePrice: 0,
                    sellingPrice: Number(masterProduct.sellingPrice || 0)
                });

            }

        }

        // =================================================
        // STOCK NOT FOUND
        // =================================================

        if (!stock) {

            return res.status(404).json({
                success: false,
                message:
                    "Product not found in stock"
            });

        }


        // =================================================
        // CHECK STOCK STATUS
        // =================================================

        if (
            stock.status === "sold" ||
            stock.quantity <= 0
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "This product is already sold"
            });

        }


        // =================================================
        // CHECK OTHER INVALID STATUS
        // =================================================

        if (
            stock.status === "damaged" ||
            stock.status === "reserved"
        ) {

            return res.status(400).json({
                success: false,
                message:
                    `Product cannot be sold because its status is ${stock.status}`
            });

        }


        // =================================================
        // PREVENT DUPLICATE SALE
        // =================================================

        const alreadySold =
            await SoldProduct.findOne({

                stockId: stock._id,

                status: "sold"

            });


        if (alreadySold) {

            return res.status(400).json({
                success: false,
                message:
                    "This stock item has already been sold"
            });

        }


        // =================================================
        // SELLING PRICE
        // =================================================

        let finalPrice =
            stock.sellingPrice;


        if (
            sellingPrice !== undefined &&
            sellingPrice !== ""
        ) {

            finalPrice =
                Number(sellingPrice);

        }

        else if (
            soldPrice !== undefined &&
            soldPrice !== ""
        ) {

            finalPrice =
                Number(soldPrice);

        }


        if (
            Number.isNaN(finalPrice) ||
            finalPrice < 0
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Invalid selling price"
            });

        }


        // =================================================
        // CREATE SOLD PRODUCT
        // =================================================

        const soldProduct =
            await SoldProduct.create({

                stockId:
                    stock._id,

                product:
                    stock.product,

                barcode:
                    stock.barcode || "",

                imei:
                    stock.imei || "",

                serialNo:
                    stock.serialNo || "",

                quantity: 1,

                sellingPrice:
                    finalPrice,

                totalAmount:
                    finalPrice,

                customerName:
                    customerName
                        ? customerName.trim()
                        : "",

                customerPhone:
                    customerPhone
                        ? customerPhone.trim()
                        : "",

                invoiceNo:
                    invoiceNo
                        ? invoiceNo.trim()
                        : "",

                paymentMethod:
                    paymentMethod || "cash",

                soldBy:
                    soldBy &&
                    mongoose.isValidObjectId(
                        soldBy
                    )
                        ? soldBy
                        : undefined,

                soldDate:
                    new Date(),

                status:
                    "sold"

            });


        // =================================================
        // UPDATE STOCK
        // =================================================

        stock.quantity =
            Math.max(
                Number(stock.quantity || 0) - 1,
                0
            );


        if (
            stock.quantity === 0
        ) {

            stock.status =
                "sold";

            stock.soldDate =
                new Date();

        }

        else {

            stock.status =
                "in_stock";

        }


        await stock.save();


        // =================================================
        // RESPONSE
        // =================================================

        return res.status(201).json({

            success: true,

            message:
                "Product sold successfully",

            data:
                soldProduct,

            remainingStock:
                stock.quantity

        });

    }

    catch (error) {

        console.error(
            "❌ Sell Product Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Server error while selling product",

            error:
                error.message

        });

    }

});


// =====================================================
// GET SOLD PRODUCTS
// SEARCH
// =====================================================

router.get("/", async (req, res) => {

    try {

        const {
            search,
            soldBy,
            date
        } = req.query;


        const filter = {
            status: "sold"
        };


        // =================================================
        // SEARCH IMEI / BARCODE / SERIAL
        // =================================================

        if (
            search &&
            search.trim()
        ) {

            const searchValue =
                search.trim();


            filter.$or = [

                {
                    imei: {
                        $regex:
                            searchValue,
                        $options: "i"
                    }
                },

                {
                    barcode: {
                        $regex:
                            searchValue,
                        $options: "i"
                    }
                },

                {
                    serialNo: {
                        $regex:
                            searchValue,
                        $options: "i"
                    }
                }

            ];

        }


        // =================================================
        // SOLD BY
        // =================================================

        if (
            soldBy &&
            mongoose.isValidObjectId(
                soldBy
            )
        ) {

            filter.soldBy =
                soldBy;

        }


        // =================================================
        // DATE FILTER
        // =================================================

        if (date) {

            const startDate =
                new Date(
                    `${date}T00:00:00`
                );


            const endDate =
                new Date(
                    `${date}T23:59:59.999`
                );


            if (
                !Number.isNaN(
                    startDate.getTime()
                )
            ) {

                filter.soldDate = {

                    $gte:
                        startDate,

                    $lte:
                        endDate

                };

            }

        }


        // =================================================
        // FETCH SOLD PRODUCTS
        // =================================================

        const soldProducts =
            await SoldProduct.find(
                filter
            )

                .populate({

                    path: "product",

                    populate: {

                        path: "brand",

                        select: "name"

                    }

                })

                .populate({

                    path: "soldBy",

                    select:
                        "name username email"

                })

                .sort({

                    soldDate: -1

                });


        // =================================================
        // RESPONSE
        // =================================================

        return res.json({

            success: true,

            count:
                soldProducts.length,

            data:
                soldProducts

        });

    }

    catch (error) {

        console.error(
            "❌ Get Sold Products Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Server error while fetching sold products",

            error:
                error.message

        });

    }

});


// =====================================================
// GET SINGLE SOLD PRODUCT
// =====================================================

router.get("/:id", async (req, res) => {

    try {

        const {
            id
        } = req.params;


        if (
            !mongoose.isValidObjectId(id)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid sold product ID"

            });

        }


        const soldProduct =
            await SoldProduct.findById(id)

                .populate({

                    path: "product",

                    populate: {

                        path: "brand",

                        select: "name"

                    }

                })

                .populate({

                    path: "soldBy",

                    select:
                        "name username email"

                });


        if (!soldProduct) {

            return res.status(404).json({

                success: false,

                message:
                    "Sold product not found"

            });

        }


        return res.json({

            success: true,

            data:
                soldProduct

        });

    }

    catch (error) {

        console.error(
            "❌ Get Sold Product Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


// =====================================================
// UPDATE SOLD PRODUCT
// =====================================================

router.put("/:id", async (req, res) => {

    try {

        const {
            id
        } = req.params;


        if (
            !mongoose.isValidObjectId(id)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid sold product ID"

            });

        }


        // Don't allow changing stock/product
        // through normal update

        const allowedFields = [

            "sellingPrice",
            "customerName",
            "customerPhone",
            "invoiceNo",
            "paymentMethod"

        ];


        const updateData = {};


        allowedFields.forEach(
            field => {

                if (
                    req.body[field] !==
                    undefined
                ) {

                    updateData[field] =
                        req.body[field];

                }

            }
        );


        if (
            updateData.sellingPrice !==
            undefined
        ) {

            updateData.sellingPrice =
                Number(
                    updateData.sellingPrice
                );

        }


        const soldProduct =
            await SoldProduct.findByIdAndUpdate(

                id,

                updateData,

                {
                    new: true,
                    runValidators: true
                }

            );


        if (!soldProduct) {

            return res.status(404).json({

                success: false,

                message:
                    "Sold product not found"

            });

        }


        return res.json({

            success: true,

            message:
                "Sold product updated successfully",

            data:
                soldProduct

        });

    }

    catch (error) {

        console.error(
            "❌ Update Sold Product Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


// =====================================================
// DELETE SOLD RECORD
// =====================================================

router.delete("/:id", async (req, res) => {

    try {

        const {
            id
        } = req.params;


        if (
            !mongoose.isValidObjectId(id)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid sold product ID"

            });

        }


        const soldProduct =
            await SoldProduct.findByIdAndDelete(
                id
            );


        if (!soldProduct) {

            return res.status(404).json({

                success: false,

                message:
                    "Sold product not found"

            });

        }


        return res.json({

            success: true,

            message:
                "Sold product record deleted successfully"

        });

    }

    catch (error) {

        console.error(
            "❌ Delete Sold Product Error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Server error",

            error:
                error.message

        });

    }

});


module.exports = router;