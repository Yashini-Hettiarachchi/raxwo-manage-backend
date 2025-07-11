const mongoose = require('mongoose');

const deletedProductSchema = new mongoose.Schema({
  itemCode: String,
  itemName: String,
  category: String,
  buyingPrice: Number,
  sellingPrice: Number,
  stock: Number,
  supplierName: String,
  changeHistory: Array, // Store the full changeHistory array
  deletedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.DeletedProduct || mongoose.model('DeletedProduct', deletedProductSchema); 