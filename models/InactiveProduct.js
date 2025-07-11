const mongoose = require('mongoose');

const InactiveProductSchema = new mongoose.Schema({
  itemCode: String,
  itemName: String,
  category: String,
  buyingPrice: Number,
  sellingPrice: Number,
  stock: Number,
  supplierName: String,
  newBuyingPrice: Number,
  newSellingPrice: Number,
  newStock: Number,
  oldStock: Number,
  oldBuyingPrice: Number,
  oldSellingPrice: Number,
  changeHistory: Array,
  deletedBy: String,
  deletedAt: Date,
  originalProductId: mongoose.Schema.Types.ObjectId,
});

module.exports = mongoose.model('InactiveProduct', InactiveProductSchema, 'inactive_products'); 