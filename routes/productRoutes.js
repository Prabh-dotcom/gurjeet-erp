const express = require("express");
const router = express.Router();

const Product = require("../models/Product");

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

        res.status(201).json({
            success: true,
            message: "Product created successfully",
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

router.get("/", async (req, res) => {
    try {
        const { brand, category, search } = req.query;

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