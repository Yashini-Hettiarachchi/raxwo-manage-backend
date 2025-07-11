const mongoose = require('mongoose');

const DeletedProductLogSchema = new mongoose.Schema({
  itemCode: String,
  itemName: String,
  category: String,
  supplierName: String,
  deletedAt: Date,
  changeHistory: Array,
});

module.exports = mongoose.model('DeletedProductLog', DeletedProductLogSchema); 