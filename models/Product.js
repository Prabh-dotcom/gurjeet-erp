const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
    {
        brand: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Brand",
            required: true
        },

        category: {
            type: String,
            required: true,
            trim: true
        },

        productName: {
            type: String,
            required: true,
            trim: true
        },

        model: {
            type: String,
            required: true,
            trim: true
        },

        variant: {
            type: String,
            trim: true
        },

        ram: {
            type: String,
            trim: true
        },

        storage: {
            type: String,
            trim: true
        },

        color: {
            type: String,
            trim: true
        },

        barcode: {
            type: String,
            trim: true
        },

        imei: {
            type: String,
            trim: true,
            default: undefined,
            validate: {
                validator: function (value) {
                    return !value || /^\d{15}$/.test(value);
                },
                message: "IMEI must contain exactly 15 digits"
            }
        },

        imeiRequired: {
            type: Boolean,
            default: true
        },

        sellingPrice: {
    type: Number,
    default: 0,
    min: 0
       },
        warranty: {
            type: Number,
            default: 0,
            min: 0
        },

        minimumStock: {
            type: Number,
            default: 10,
            min: 0
        },

        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active"
        }
    },
    {
        timestamps: true
    }
);

productSchema.index({ model: 1 });
productSchema.index({ barcode: 1 });
productSchema.index({ category: 1 });

module.exports = mongoose.model("Product", productSchema);