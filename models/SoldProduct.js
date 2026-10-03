const mongoose = require("mongoose");

const soldProductSchema = new mongoose.Schema(
    {
        stockId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Stock",
            required: true
        },

        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true
        },

        barcode: {
            type: String,
            trim: true,
            default: ""
        },

        imei: {
            type: String,
            trim: true
        },

        serialNo: {
            type: String,
            trim: true
        },

        soldDate: {
            type: Date,
            default: Date.now
        },

        soldBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },

        sellingPrice: {
            type: Number,
            required: true,
            min: 0
        },

        customerName: {
            type: String,
            trim: true
        },

        customerPhone: {
            type: String,
            trim: true
        },

        invoiceNo: {
            type: String,
            trim: true
        },

        paymentMethod: {
            type: String,
            enum: [
                "cash",
                "upi",
                "card",
                "bank_transfer",
                "other"
            ],
            default: "cash"
        },

        status: {
            type: String,
            enum: ["sold", "returned"],
            default: "sold"
        }
    },
    {
        timestamps: true
    }
);

soldProductSchema.index({ barcode: 1 });
soldProductSchema.index({ imei: 1 });
soldProductSchema.index({ soldDate: -1 });

module.exports = mongoose.model(
    "SoldProduct",
    soldProductSchema
);