const mongoose = require('mongoose');

const clickedProductSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  itemCode: {
    type: String,
    required: true
  },
  itemName: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  buyingPrice: {
    type: Number,
    required: true
  },
  sellingPrice: {
    type: Number,
    required: true
  },
  stock: {
    type: Number,
    required: true
  },
  supplierName: {
    type: String,
    required: true
  },
  clickedAt: {
    type: Date,
    default: Date.now
  },
  clickedBy: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'processed', 'archived'],
    default: 'active'
  }
}, { timestamps: true });

module.exports = mongoose.models.ClickedProduct || mongoose.model('ClickedProduct', clickedProductSchema); 