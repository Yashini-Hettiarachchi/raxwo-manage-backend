const mongoose = require('mongoose');

const deletedProductSchema = new mongoose.Schema({
  // Original product data
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
    default: 0
  },
  supplierName: {
    type: String,
    required: true
  },
  // New Updated Values
  newBuyingPrice: Number,
  newSellingPrice: Number,
  newStock: Number,
  // Old Values
  oldStock: Number,
  oldBuyingPrice: Number,
  oldSellingPrice: Number,
  // Change history
  changeHistory: [{
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    changedBy: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
    changeType: { type: String, enum: ['create', 'update', 'delete', 'stock'], required: true }
  }],
  // Deletion metadata
  deleted: { type: Boolean, default: true },
  deletedAt: { type: Date, required: true },
  deletedBy: { type: String, required: true },
  // Original product ID for reference
  originalProductId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.models.DeletedProduct || mongoose.model('DeletedProduct', deletedProductSchema); 