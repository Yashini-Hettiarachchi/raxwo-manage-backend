const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const Product = require('../models/Product');
const ExcelProduct = require('../models/ExcelProduct');
const DeletedProductLog = require('../models/DeletedProductLog');
const DeletedProduct = require('../models/DeletedProduct');
const InactiveProduct = require('../models/InactiveProduct');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// GET: Get all products (only non-deleted and visible)
router.get('/', async (req, res) => {
  try {
    console.log('Fetching products - filtering out deleted and hidden products');
    const products = await Product.find({ 
      deleted: { $ne: true },
      visible: { $ne: false }
    });
    console.log(`Found ${products.length} active and visible products`);
    res.json(products);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET: Get a specific deleted product by ID
router.get('/deleted/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const deletedProduct = await DeletedProduct.findById(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Deleted product not found' });
    }
    res.json(deletedProduct);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE: Permanently delete a product from deleted_products collection
router.delete('/deleted/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const deletedProduct = await DeletedProduct.findById(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Deleted product not found' });
    }

    // Also permanently delete from original collection if it still exists
    await Product.findByIdAndDelete(deletedProduct.originalProductId);

    // Remove from deleted_products collection
    await DeletedProduct.findByIdAndDelete(req.params.id);

    res.json({ message: 'Product permanently deleted from both collections' });
  } catch (err) {
    console.error('Error permanently deleting product:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET: Get all Excel upload logs
router.get('/excel-uploads', async (req, res) => {
  try {
    const logs = await ExcelProduct.find().sort({ createdAt: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: Fetch all deleted product logs (must be before any /:id route)
router.get('/deleted-logs', async (req, res) => {
  try {
    const logs = await DeletedProductLog.find().sort({ deletedAt: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Middleware: Function to get a product by ID with ObjectId validation
async function getProduct(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid product ID format' });
  }

  let product;
  try {
    // Find product regardless of deleted status
    product = await Product.findById(req.params.id);
    if (product == null) {
      return res.status(404).json({ message: 'Cannot find product' });
    }
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
  res.product = product;
  next();
}

// PATCH: Soft delete a product (mark as deleted and copy to deleted_products collection)
router.patch('/soft-delete/:id', getProduct, async (req, res) => {
  try {
    console.log('Soft deleting product:', req.params.id);
    const changedBy = req.body.changedBy || req.query.changedBy || 'system';
    
    // Add delete log to change history
    res.product.changeHistory = [
      ...(res.product.changeHistory || []),
      {
        field: 'product',
        oldValue: JSON.stringify(res.product),
        newValue: null,
        changedBy,
        changedAt: new Date(),
        changeType: 'delete'
      }
    ];

    // Mark as deleted in original collection
    res.product.deleted = true;
    res.product.deletedAt = new Date();
    res.product.deletedBy = changedBy;

    console.log('Product before save - deleted flag:', res.product.deleted);
    console.log('Product before save - deletedAt:', res.product.deletedAt);
    console.log('Product before save - deletedBy:', res.product.deletedBy);

    // Save the updated product in original collection
    await res.product.save();
    console.log('Product soft deleted successfully in original collection:', res.product.itemName);

    // Copy to deleted_products collection
    try {
      const deletedProduct = new DeletedProduct({
        itemCode: res.product.itemCode,
        itemName: res.product.itemName,
        category: res.product.category,
        buyingPrice: res.product.buyingPrice,
        sellingPrice: res.product.sellingPrice,
        stock: res.product.stock,
        supplierName: res.product.supplierName,
        newBuyingPrice: res.product.newBuyingPrice,
        newSellingPrice: res.product.newSellingPrice,
        newStock: res.product.newStock,
        oldStock: res.product.oldStock,
        oldBuyingPrice: res.product.oldBuyingPrice,
        oldSellingPrice: res.product.oldSellingPrice,
        changeHistory: res.product.changeHistory,
        deleted: true,
        deletedAt: new Date(),
        deletedBy: changedBy,
        originalProductId: res.product._id
      });

      await deletedProduct.save();
      console.log('Product copied to deleted_products collection successfully');
      
      res.json({ 
        message: 'Product marked as deleted and copied to deleted products collection',
        originalProductId: res.product._id,
        deletedProductId: deletedProduct._id
      });
    } catch (copyErr) {
      console.error('Error copying to deleted_products collection:', copyErr);
      // Even if copying fails, the product is still soft-deleted in original collection
      res.json({ 
        message: 'Product marked as deleted but failed to copy to deleted products collection',
        error: copyErr.message,
        originalProductId: res.product._id
      });
    }
  } catch (err) {
    console.error('Error soft deleting product:', err);
    res.status(500).json({ message: err.message });
  }
});

// POST: Log a product deletion (for tracking deletions from frontend)
router.post('/deletion-log', async (req, res) => {
  try {
    const { 
      productId, 
      itemCode, 
      itemName, 
      category, 
      supplierName, 
      deletedBy, 
      deletionType, 
      changeHistory 
    } = req.body;

    // Validate required fields
    if (!itemCode || !itemName || !deletedBy || !deletionType) {
      return res.status(400).json({ 
        message: 'Missing required fields: itemCode, itemName, deletedBy, deletionType are required' 
      });
    }

    // Create deletion log
    const deletionLog = new DeletedProductLog({
      itemCode,
      itemName,
      category: category || 'Unknown',
      supplierName: supplierName || 'Unknown',
      deletedAt: new Date(),
      deletedBy,
      deletionType, // 'hard' or 'soft'
      originalProductId: productId,
      changeHistory: changeHistory || []
    });

    await deletionLog.save();
    console.log('Deletion log created:', deletionLog.itemName, 'by', deletedBy, 'type:', deletionType);

    res.status(201).json({ 
      message: 'Deletion logged successfully',
      logId: deletionLog._id,
      deletedProduct: {
        itemCode,
        itemName,
        category,
        supplierName,
        deletedAt: deletionLog.deletedAt,
        deletedBy,
        deletionType
      }
    });
  } catch (err) {
    console.error('Error logging deletion:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT: Inactivate a product (move to inactive_products collection)
router.put('/inactivate/:id', async (req, res) => {
  try {
    const { username } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Copy to inactive collection
    const inactive = new InactiveProduct({
      ...product.toObject(),
      deletedBy: username,
      deletedAt: new Date(),
      originalProductId: product._id,
    });
    await inactive.save();

    // Remove from active collection
    await product.deleteOne();

    res.json({ message: 'Product moved to inactive', inactiveProductId: inactive._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: List all inactive products
router.get('/inactive', async (req, res) => {
  try {
    const inactives = await InactiveProduct.find().sort({ deletedAt: -1 });
    res.json(inactives);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT: Toggle product visibility
router.put('/toggle-visibility/:id', async (req, res) => {
  try {
    const { username } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Toggle visibility
    product.visible = !product.visible;
    
    if (!product.visible) {
      // Product is being hidden
      product.hiddenAt = new Date();
      product.hiddenBy = username;
    } else {
      // Product is being made visible again
      product.hiddenAt = undefined;
      product.hiddenBy = undefined;
    }

    // Add to change history
    product.changeHistory = [
      ...(product.changeHistory || []),
      {
        field: 'visibility',
        oldValue: !product.visible,
        newValue: product.visible,
        changedBy: username,
        changedAt: new Date(),
        changeType: product.visible ? 'restore' : 'hide'
      }
    ];

    await product.save();
    
    const action = product.visible ? 'made visible' : 'hidden';
    res.json({ 
      message: `Product ${action} successfully`,
      visible: product.visible,
      productId: product._id
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: List all hidden products
router.get('/hidden', async (req, res) => {
  try {
    const hiddenProducts = await Product.find({ visible: false }).sort({ hiddenAt: -1 });
    res.json(hiddenProducts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: Get all deleted products from deleted_products collection
router.get('/deleted', async (req, res) => {
  try {
    console.log('Fetching deleted products...');
    const deletedProducts = await DeletedProduct.find().sort({ deletedAt: -1 });
    console.log(`Found ${deletedProducts.length} deleted products`);
    res.json(deletedProducts);
  } catch (err) {
    console.error('Error fetching deleted products:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET: Get a single product by ID
router.get('/:id', getProduct, (req, res) => {
  res.json(res.product);
});

// POST: Create a new product
router.post('/', async (req, res) => {
  try {
    const existingProduct = await Product.findOne({ itemCode: req.body.itemCode });
    if (existingProduct) {
      return res.status(400).json({ message: "Item Code already exists. Please use a unique Item Code." });
    }

    const changeHistory = [{
      field: 'creation',
      oldValue: null,
      newValue: req.body,
      changedBy: req.body.changedBy || 'system',
      changedAt: new Date(),
      changeType: 'create'
    }];
    // If this is from Excel upload, add an addExpense log
    if (req.body.excelUpload) {
      changeHistory.push({
        field: 'stock',
        oldValue: 0,
        newValue: req.body.stock,
        changedBy: req.body.changedBy || 'system',
        changedAt: new Date(),
        changeType: 'addExpense'
      });
    }

    const product = new Product({
      itemCode: req.body.itemCode,
      itemName: req.body.itemName,
      category: req.body.category,
      buyingPrice: req.body.buyingPrice,
      sellingPrice: req.body.sellingPrice,
      stock: req.body.stock,
      supplierName: req.body.supplierName,
      deleted: false, // Explicitly set as not deleted
      visible: true, // Explicitly set as visible
      changeHistory
    });

    const newProduct = await product.save();
    res.status(201).json(newProduct);
  } catch (err) {
    // Check for MongoDB duplicate key error (code 11000)
    if (err.code === 11000 && err.keyPattern && err.keyPattern.itemCode) {
      return res.status(400).json({ message: "Item Code already exists. Please use a unique Item Code." });
    }
    res.status(400).json({ message: err.message });
  }
});

// PATCH: Update an existing product (partial update)
router.patch('/:id', getProduct, async (req, res) => {
  const updates = req.body;
  const changes = [];
  
  // Handle soft delete
  if (updates.isDeleted === true) {
    const changedBy = updates.changedBy || 'system';
    console.log('Soft deleting product:', res.product.itemName, 'ID:', res.product._id);
    
    // Add delete log to change history
    res.product.changeHistory = [
      ...(res.product.changeHistory || []),
      {
        field: 'product',
        oldValue: JSON.stringify(res.product),
        newValue: null,
        changedBy,
        changedAt: new Date(),
        changeType: 'delete'
      }
    ];

    // Mark as deleted
    res.product.deleted = true;
    res.product.deletedAt = new Date();
    res.product.deletedBy = changedBy;

    console.log('Product before save - deleted flag:', res.product.deleted);
    console.log('Product before save - deletedAt:', res.product.deletedAt);
    console.log('Product before save - deletedBy:', res.product.deletedBy);

    try {
      await res.product.save();
      console.log('Product saved successfully with deleted flag');
      res.json({ message: 'Product marked as deleted' });
    } catch (err) {
      console.error('Error saving deleted product:', err);
      res.status(500).json({ message: err.message });
    }
    return;
  }
  
  // Handle soft restore
  if (updates.isDeleted === false) {
    const changedBy = updates.changedBy || 'system';
    
    // Add restore log to change history
    res.product.changeHistory = [
      ...(res.product.changeHistory || []),
      {
        field: 'product',
        oldValue: null,
        newValue: JSON.stringify(res.product),
        changedBy,
        changedAt: new Date(),
        changeType: 'restore'
      }
    ];

    // Mark as not deleted
    res.product.deleted = false;
    res.product.deletedAt = undefined;
    res.product.deletedBy = undefined;

    try {
      await res.product.save();
      res.json({ message: 'Product restored successfully' });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
    return;
  }
  
  // Handle regular updates
  for (const [field, newValue] of Object.entries(updates)) {
    if (res.product[field] != newValue) {
      changes.push({
        field,
        oldValue: res.product[field],
        newValue,
        changedBy: req.body.changedBy || 'system',
        changedAt: new Date(),
        changeType: 'update'
      });
      res.product[field] = newValue;
    }
  }
  if (changes.length > 0) {
    res.product.changeHistory = [...(res.product.changeHistory || []), ...changes];
  }
  try {
    const updatedProduct = await res.product.save();
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT: Full update of a product by ID
router.put('/:id', getProduct, async (req, res) => {
  // List of updatable fields
  const updatableFields = [
    'itemCode', 'itemName', 'category', 'buyingPrice', 'sellingPrice', 'stock', 'supplierName',
    'newBuyingPrice', 'newSellingPrice', 'newStock',
    'oldStock', 'oldBuyingPrice', 'oldSellingPrice'
  ];

  // Check for itemCode uniqueness if changed
  if (req.body.itemCode && req.body.itemCode !== res.product.itemCode) {
    try {
      const existingProduct = await Product.findOne({ itemCode: req.body.itemCode });
      if (existingProduct) {
        return res.status(400).json({ message: 'GRN already exists. Please use a unique Item Code.' });
      }
    } catch (err) {
      return res.status(500).json({ message: 'Error checking item code: ' + err.message });
    }
  }

  // Replace all updatable fields
  const changes = [];
  for (const field of updatableFields) {
    if (req.body[field] !== undefined && res.product[field] !== req.body[field]) {
      changes.push({
        field,
        oldValue: res.product[field],
        newValue: req.body[field],
        changedBy: req.body.changedBy || 'system',
        changedAt: new Date(),
        changeType: 'update'
      });
      // If this is from Excel upload and field is stock, add addExpense log
      if (req.body.excelUpload && field === 'stock') {
        changes.push({
          field: 'stock',
          oldValue: res.product[field],
          newValue: req.body[field],
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'addExpense'
        });
      }
    }
  }
  if (changes.length > 0) {
    res.product.changeHistory = [...(res.product.changeHistory || []), ...changes];
  }

  try {
    const updatedProduct = await res.product.save();
    res.json(updatedProduct);
  } catch (err) {
    if (err.code === 11000 && err.keyPattern && err.keyPattern.itemCode) {
      return res.status(400).json({ message: 'GRN already exists. Please use a unique Item Code.' });
    }
    res.status(400).json({ message: err.message });
  }
});

// DELETE: Remove a product
router.delete('/:id', getProduct, async (req, res) => {
  try {
    const changedBy = req.body.changedBy || req.query.changedBy || 'system';
    res.product.changeHistory = [
      ...(res.product.changeHistory || []),
      {
        field: 'product',
        oldValue: JSON.stringify(res.product),
        newValue: null,
        changedBy,
        changedAt: new Date(),
        changeType: 'delete'
      }
    ];
    await res.product.save();

    // ARCHIVE: Save to DeletedProductLog BEFORE deleting
    let archive;
    try {
      archive = await DeletedProductLog.create({
        itemCode: res.product.itemCode,
        itemName: res.product.itemName,
        category: res.product.category,
        supplierName: res.product.supplierName,
        deletedAt: new Date(),
        changeHistory: res.product.changeHistory,
      });
    } catch (archiveErr) {
      return res.status(500).json({ message: 'Failed to archive deleted product. Product was NOT deleted.', error: archiveErr.message });
    }

    if (!archive) {
      return res.status(500).json({ message: 'Failed to archive deleted product. Product was NOT deleted.' });
    }

    // DELETE: Remove from main collection
    await res.product.deleteOne();
    res.json({ message: 'Deleted Product' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: Get a product by itemCode
router.get('/itemCode/:itemCode', async (req, res) => {
  try {
    const product = await Product.findOne({ itemCode: req.params.itemCode });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH: Restore a deleted product from deleted_products collection
router.patch('/restore/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid product ID format' });
    }

    const changedBy = req.body.changedBy || req.query.changedBy || 'system';
    
    // Find the deleted product in deleted_products collection
    const deletedProduct = await DeletedProduct.findById(req.params.id);
    if (!deletedProduct) {
      return res.status(404).json({ message: 'Deleted product not found' });
    }

    // Find the original product in the main collection
    const originalProduct = await Product.findById(deletedProduct.originalProductId);
    if (!originalProduct) {
      return res.status(404).json({ message: 'Original product not found' });
    }

    // Add restore log to change history
    originalProduct.changeHistory = [
      ...(originalProduct.changeHistory || []),
      {
        field: 'product',
        oldValue: null,
        newValue: JSON.stringify(originalProduct),
        changedBy,
        changedAt: new Date(),
        changeType: 'restore'
      }
    ];

    // Mark as not deleted in original collection
    originalProduct.deleted = false;
    originalProduct.deletedAt = undefined;
    originalProduct.deletedBy = undefined;

    await originalProduct.save();
    console.log('Product restored successfully in original collection');

    // Remove from deleted_products collection
    await DeletedProduct.findByIdAndDelete(req.params.id);
    console.log('Product removed from deleted_products collection');

    res.json({ 
      message: 'Product restored successfully',
      originalProductId: originalProduct._id
    });
  } catch (err) {
    console.error('Error restoring product:', err);
    res.status(500).json({ message: err.message });
  }
});

// PATCH: Update stock and price of an existing product or create new
router.patch('/update-stock/:itemCode', async (req, res) => {
  try {
    const itemCode = decodeURIComponent(req.params.itemCode);
    const { newStock, newBuyingPrice, newSellingPrice, itemName, category, supplierName } = req.body;

    // Validate required fields
    if (!itemName || typeof itemName !== 'string' || itemName.trim() === '') {
      return res.status(400).json({ message: 'Item name is required and must be a non-empty string' });
    }
    if (!category || typeof category !== 'string' || category.trim() === '') {
      return res.status(400).json({ message: 'Category is required and must be a non-empty string' });
    }
    if (newStock === undefined || newStock === null || newStock === '' || isNaN(Number(newStock)) || Number(newStock) < 0) {
      return res.status(400).json({ message: 'New stock is required and must be a non-negative number' });
    }
    if (newBuyingPrice === undefined || newBuyingPrice === null || newBuyingPrice === '' || isNaN(Number(newBuyingPrice)) || Number(newBuyingPrice) < 0) {
      return res.status(400).json({ message: 'New buying price is required and must be a non-negative number' });
    }
    if (newSellingPrice === undefined || newSellingPrice === null || newSellingPrice === '' || isNaN(Number(newSellingPrice)) || Number(newSellingPrice) < 0) {
      return res.status(400).json({ message: 'New selling price is required and must be a non-negative number' });
    }
    if (!supplierName || typeof supplierName !== 'string' || supplierName.trim() === '') {
      return res.status(400).json({ message: 'Supplier name is required and must be a non-empty string' });
    }

    let product = await Product.findOne({ itemCode });

    if (!product) {
      // Check if itemCode is already used by another product (double-check)
      const duplicateCheck = await Product.findOne({ itemCode });
      if (duplicateCheck) {
        return res.status(400).json({ message: "Item Code already exists. Please use a unique Item Code." });
      }

      // Create new product if it doesn't exist
      product = new Product({
        itemCode,
        itemName,
        category,
        buyingPrice: Number(newBuyingPrice),
        sellingPrice: Number(newSellingPrice),
        stock: Number(newStock),
        supplierName,
        deleted: false, // Explicitly set as not deleted
        visible: true, // Explicitly set as visible
        changeHistory: [{
          field: 'creation',
          oldValue: null,
          newValue: { itemCode, itemName, category, buyingPrice: Number(newBuyingPrice), sellingPrice: Number(newSellingPrice), stock: Number(newStock), supplierName },
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'create'
        }]
      });
    } else {
      // Log stock change
      const changes = [];
      if (product.stock !== newStock) {
        changes.push({
          field: 'stock',
          oldValue: product.stock,
          newValue: newStock,
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'update'
        });
      }
      if (product.buyingPrice !== newBuyingPrice) {
        changes.push({
          field: 'buyingPrice',
          oldValue: product.buyingPrice,
          newValue: newBuyingPrice,
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'update'
        });
      }
      if (product.sellingPrice !== newSellingPrice) {
        changes.push({
          field: 'sellingPrice',
          oldValue: product.sellingPrice,
          newValue: newSellingPrice,
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'update'
        });
      }
      if (changes.length > 0) {
        product.changeHistory = [...(product.changeHistory || []), ...changes];
      }
      // Update the stock and prices
      product.stock += Number(newStock);
      product.buyingPrice = Number(newBuyingPrice);
      product.sellingPrice = Number(newSellingPrice);
      product.supplierName = supplierName;
    }

    const updatedProduct = await product.save();
    res.json({ message: "Stock updated successfully", updatedProduct });
  } catch (err) {
    // Check for MongoDB duplicate key error (code 11000)
    if (err.code === 11000 && err.keyPattern && err.keyPattern.itemCode) {
      return res.status(400).json({ message: "Item Code already exists. Please use a unique Item Code." });
    }
    res.status(400).json({ message: err.message });
  }
});

// PATCH: Process product return
router.patch('/return/:id', async (req, res) => {
  try {
    const { returnQuantity, returnType } = req.body;
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const quantity = Number(returnQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      console.error('Invalid return quantity:', returnQuantity);
      return res.status(400).json({ message: 'Invalid return quantity' });
    }

    if (returnType === 'out-stock') {
      if (product.stock < quantity) {
        console.error('Return quantity exceeds available stock:', quantity);
        return res.status(400).json({ message: 'Return quantity exceeds available stock' });
      }
      // Log stock change before reducing
      product.changeHistory = [
        ...(product.changeHistory || []),
        {
          field: 'stock',
          oldValue: product.stock,
          newValue: product.stock - quantity,
          changedBy: req.body.changedBy || 'system',
          changedAt: new Date(),
          changeType: 'update'
        }
      ];
      product.stock -= quantity; // Reduce stock
    }

    const updatedProduct = await product.save();
    res.json({ message: 'Product return processed', updatedProduct });
  } catch (err) {
    console.error('Error processing return:', err);
    res.status(500).json({ message: err.message });
  }
});

// POST: Bulk upload products from Excel file
router.post('/upload-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (jsonData.length === 0) {
      return res.status(400).json({ message: 'Excel file is empty or has no data' });
    }

    const username = req.body.uploadedBy || 'system';
    const replaceMode = req.body.replaceMode === 'true';
    const addMode = req.body.addMode === 'true' || req.body.addMode === true;
    console.log('Excel upload mode - replaceMode:', replaceMode, 'addMode:', addMode);
    console.log('Request body addMode value:', req.body.addMode);
    console.log('Request body addMode type:', typeof req.body.addMode);
    console.log('Request body:', req.body);
    const results = [];
    const errors = [];

    // If in replace mode, delete all existing products first
    if (replaceMode) {
      try {
        console.log('Replace mode enabled - deleting all existing products');
        await Product.deleteMany({});
        console.log('All existing products deleted');
      } catch (deleteError) {
        console.error('Error deleting existing products:', deleteError);
        return res.status(500).json({ message: 'Error deleting existing products: ' + deleteError.message });
      }
    }

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      
      try {
        console.log(`Processing row ${i + 1}:`, row);
        // Extract data from Excel row - all fields are optional
        const itemName = row['Item Name'] || row['itemName'] || row['ItemName'];
        const category = row['Category'] || row['category'];
        const buyingPrice = parseFloat(String(row['Buying Price'] || row['buyingPrice'] || row['BuyingPrice'] || 0).replace(/Rs\.?\s*/, ''));
        const sellingPrice = parseFloat(String(row['Selling Price'] || row['sellingPrice'] || row['SellingPrice'] || 0).replace(/Rs\.?\s*/, ''));
        const stock = parseInt(row['Stock'] || row['stock'] || 0, 10);
        const supplierName = row['Supplier'] || row['supplierName'] || row['SupplierName'];
        const itemCode = row['Item Code'] || row['itemCode'] || row['ItemCode'] || `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        console.log(`Extracted data for row ${i + 1}:`, { itemName, category, buyingPrice, sellingPrice, stock, supplierName, itemCode });

        // Make all fields optional - provide default values for missing fields
        // Default values: Item Name = "Product-{timestamp}-{row}", Category = "General", 
        // Prices = 0, Stock = 0, Supplier = "", Item Code = auto-generated
        const finalItemName = itemName || `Product-${Date.now()}-${i}`;
        const finalCategory = category || 'General';
        const finalBuyingPrice = buyingPrice || 0;
        const finalSellingPrice = sellingPrice || 0;
        const finalStock = stock || 0;
        const finalSupplierName = supplierName || '';
        const finalItemCode = itemCode || `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        console.log(`Final data for row ${i + 1}:`, { 
          itemName: finalItemName, 
          category: finalCategory, 
          buyingPrice: finalBuyingPrice, 
          sellingPrice: finalSellingPrice, 
          stock: finalStock, 
          supplierName: finalSupplierName, 
          itemCode: finalItemCode 
        });

        console.log(`Processing item "${finalItemName}" - replaceMode: ${replaceMode}, addMode: ${addMode}`);
        // Always create new products regardless of duplicates
        console.log('Creating new product:', finalItemName);
        const changeHistory = [{
          field: 'creation',
          oldValue: null,
          newValue: { itemName: finalItemName, category: finalCategory, buyingPrice: finalBuyingPrice, sellingPrice: finalSellingPrice, stock: finalStock, supplierName: finalSupplierName },
          changedBy: username,
          changedAt: new Date(),
          changeType: 'create'
        }];

        const newProduct = new Product({
          itemCode: finalItemCode,
          itemName: finalItemName,
          category: finalCategory,
          buyingPrice: finalBuyingPrice,
          sellingPrice: finalSellingPrice,
          stock: finalStock,
          supplierName: finalSupplierName,
          deleted: false,
          visible: true,
          changeHistory
        });

        await newProduct.save();
        results.push({ action: 'created', itemName: finalItemName, itemCode: finalItemCode });
      } catch (error) {
        errors.push({ row: i + 1, error: error.message });
      }
    }

    // Log the upload
    try {
      const log = new ExcelProduct({
        filename: req.file.originalname,
        uploadedBy: username,
        products: results
      });
      await log.save();
    } catch (logError) {
      console.error('Error logging Excel upload:', logError);
    }

    res.json({
      message: 'Excel upload completed',
      totalProcessed: jsonData.length,
      successful: results.length,
      errors: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error('Excel upload error:', error);
    res.status(500).json({ message: 'Error processing Excel file: ' + error.message });
  }
});
          
//           // Check if product exists in main collection
//           let existingProduct = await Product.findOne({ 
//             itemName: { $regex: new RegExp('^' + itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
//           });
          
//           if (existingProduct) {
//             console.log('Product exists in main collection, updating:', itemName);
//             // Update existing product with new data
//             const changes = [];
//             if (existingProduct.stock !== stock) {
//             changes.push({
//               field: 'stock',
//               oldValue: existingProduct.stock,
//               newValue: stock,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.buyingPrice !== buyingPrice) {
//             changes.push({
//               field: 'buyingPrice',
//               oldValue: existingProduct.buyingPrice,
//               newValue: buyingPrice,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.sellingPrice !== sellingPrice) {
//             changes.push({
//               field: 'sellingPrice',
//               oldValue: existingProduct.sellingPrice,
//               newValue: sellingPrice,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.category !== category) {
//             changes.push({
//               field: 'category',
//               oldValue: existingProduct.category,
//               newValue: category,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.supplierName !== supplierName) {
//             changes.push({
//               field: 'supplierName',
//               oldValue: existingProduct.supplierName,
//               newValue: supplierName,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }

//           if (changes.length > 0) {
//             existingProduct.changeHistory = [...(existingProduct.changeHistory || []), ...changes];
//           }

//           existingProduct.stock = stock;
//           existingProduct.buyingPrice = buyingPrice;
//           existingProduct.sellingPrice = sellingPrice;
//           existingProduct.category = category;
//           existingProduct.supplierName = supplierName;
//           existingProduct.deleted = false; // Ensure it's not deleted
//           existingProduct.visible = true; // Ensure it's visible

//           await existingProduct.save();
//           results.push({ action: 'updated', itemName, itemCode: existingProduct.itemCode, reason: 'Updated existing product' });
//         } else {
//           // Check if product exists in deleted products
//           const DeletedProduct = require('../models/DeletedProduct');
          
//           // Debug: List all deleted products to see what's available
//           const allDeletedProducts = await DeletedProduct.find({});
//           console.log('All deleted products:', allDeletedProducts.map(dp => dp.itemName));
          
//           const deletedProduct = await DeletedProduct.findOne({ 
//             itemName: { $regex: new RegExp('^' + itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
//           });
          
//           console.log('Deleted product search result for', itemName, ':', deletedProduct ? 'Found' : 'Not found');
          
//           if (deletedProduct) {
//             console.log('Found deleted product, restoring:', itemName);
//             // Restore the deleted product with updated data
//             const changeHistory = [{
//               field: 'restore',
//               oldValue: null,
//               newValue: { itemName, category, buyingPrice, sellingPrice, stock, supplierName },
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'restore'
//             }];

//             const restoredProduct = new Product({
//               itemCode: deletedProduct.itemCode || itemCode,
//               itemName: itemName,
//               category: category || deletedProduct.category,
//               buyingPrice: buyingPrice || deletedProduct.buyingPrice,
//               sellingPrice: sellingPrice || deletedProduct.sellingPrice,
//               stock: stock || deletedProduct.stock,
//               supplierName: supplierName || deletedProduct.supplierName,
//               deleted: false, // Explicitly set as not deleted
//               visible: true, // Explicitly set as visible
//               changeHistory: [...(deletedProduct.changeHistory || []), ...changeHistory]
//             });

//             await restoredProduct.save();
            
//             // Remove from deleted products collection
//             await DeletedProduct.findByIdAndDelete(deletedProduct._id);
            
//             results.push({ action: 'restored', itemName, itemCode: restoredProduct.itemCode, reason: 'Restored from deleted products' });
//           } else {
//             console.log('Creating new product:', itemName);
//             // Create new product
//             const changeHistory = [{
//               field: 'creation',
//               oldValue: null,
//               newValue: { itemName, category, buyingPrice, sellingPrice, stock, supplierName },
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'create'
//             }];

//             const newProduct = new Product({
//               itemCode,
//               itemName,
//               category,
//               buyingPrice,
//               sellingPrice,
//               stock,
//               supplierName,
//               deleted: false, // Explicitly set as not deleted
//               visible: true, // Explicitly set as visible
//               changeHistory
//             });

//             await newProduct.save();
//             results.push({ action: 'created', itemName, itemCode });
//           }
//         }
//       } else {
//         console.log('Processing in normal mode for item:', itemName);
//         // Since addMode is the expected behavior, let's use addMode logic here too
//         console.log('Falling back to addMode logic for item:', itemName);
        
//         // Check if product exists in main collection
//         let existingProduct = await Product.findOne({ 
//           itemName: { $regex: new RegExp('^' + itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
//         });
        
//         if (existingProduct) {
//           console.log('Product exists in main collection, updating:', itemName);
//           // Update existing product with new data
//           const changes = [];
//           if (existingProduct.stock !== stock) {
//             changes.push({
//               field: 'stock',
//               oldValue: existingProduct.stock,
//               newValue: stock,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.buyingPrice !== buyingPrice) {
//             changes.push({
//               field: 'buyingPrice',
//               oldValue: existingProduct.buyingPrice,
//               newValue: buyingPrice,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.sellingPrice !== sellingPrice) {
//             changes.push({
//               field: 'sellingPrice',
//               oldValue: existingProduct.sellingPrice,
//               newValue: sellingPrice,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.category !== category) {
//             changes.push({
//               field: 'category',
//               oldValue: existingProduct.category,
//               newValue: category,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }
//           if (existingProduct.supplierName !== supplierName) {
//             changes.push({
//               field: 'supplierName',
//               oldValue: existingProduct.supplierName,
//               newValue: supplierName,
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'update'
//             });
//           }

//           if (changes.length > 0) {
//             existingProduct.changeHistory = [...(existingProduct.changeHistory || []), ...changes];
//           }

//           existingProduct.stock = stock;
//           existingProduct.buyingPrice = buyingPrice;
//           existingProduct.sellingPrice = sellingPrice;
//           existingProduct.category = category;
//           existingProduct.supplierName = supplierName;
//           existingProduct.deleted = false; // Ensure it's not deleted
//           existingProduct.visible = true; // Ensure it's visible

//           await existingProduct.save();
//           results.push({ action: 'updated', itemName, itemCode: existingProduct.itemCode, reason: 'Updated existing product' });
//         } else {
//           // Check if product exists in deleted products
//           const DeletedProduct = require('../models/DeletedProduct');
          
//           // Debug: List all deleted products to see what's available
//           const allDeletedProducts = await DeletedProduct.find({});
//           console.log('All deleted products:', allDeletedProducts.map(dp => dp.itemName));
          
//           const deletedProduct = await DeletedProduct.findOne({ 
//             itemName: { $regex: new RegExp('^' + itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
//           });
          
//           console.log('Deleted product search result for', itemName, ':', deletedProduct ? 'Found' : 'Not found');
          
//           if (deletedProduct) {
//             console.log('Found deleted product, restoring:', itemName);
//             // Restore the deleted product with updated data
//             const changeHistory = [{
//               field: 'restore',
//               oldValue: null,
//               newValue: { itemName, category, buyingPrice, sellingPrice, stock, supplierName },
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'restore'
//             }];

//             const restoredProduct = new Product({
//               itemCode: deletedProduct.itemCode || itemCode,
//               itemName: itemName,
//               category: category || deletedProduct.category,
//               buyingPrice: buyingPrice || deletedProduct.buyingPrice,
//               sellingPrice: sellingPrice || deletedProduct.sellingPrice,
//               stock: stock || deletedProduct.stock,
//               supplierName: supplierName || deletedProduct.supplierName,
//               deleted: false, // Explicitly set as not deleted
//               visible: true, // Explicitly set as visible
//               changeHistory: [...(deletedProduct.changeHistory || []), ...changeHistory]
//             });

//             await restoredProduct.save();
            
//             // Remove from deleted products collection
//             await DeletedProduct.findByIdAndDelete(deletedProduct._id);
            
//             results.push({ action: 'restored', itemName, itemCode: restoredProduct.itemCode, reason: 'Restored from deleted products' });
//           } else {
//             console.log('Creating new product:', itemName);
//             // Create new product
//             const changeHistory = [{
//               field: 'creation',
//               oldValue: null,
//               newValue: { itemName, category, buyingPrice, sellingPrice, stock, supplierName },
//               changedBy: username,
//               changedAt: new Date(),
//               changeType: 'create'
//             }];

//             const newProduct = new Product({
//               itemCode,
//               itemName,
//               category,
//               buyingPrice,
//               sellingPrice,
//               stock,
//               supplierName,
//               deleted: false, // Explicitly set as not deleted
//               visible: true, // Explicitly set as visible
//               changeHistory
//             });

//             await newProduct.save();
//             results.push({ action: 'created', itemName, itemCode });
//           }
//         }
//       }
        
//                    // Skip the old normal mode logic since we're using addMode logic above
//          return;
//        }

//       // If supplier name is provided, add to supplier's cart
//       if (supplierName && supplierName.trim() !== '') {
//         try {
//           // Find supplier by name
//           const Supplier = require('../models/Supplier');
//           const supplier = await Supplier.findOne({ 
//             supplierName: { $regex: new RegExp('^' + supplierName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }
//           });
          
//           if (supplier) {
//             // Check if item already exists in supplier's cart
//             const existingCartItem = supplier.items.find(item => 
//               item.itemCode === itemCode || 
//               item.itemName.toLowerCase() === itemName.toLowerCase()
//             );
            
//             if (!existingCartItem) {
//               // Add item to supplier's cart
//               const cartItem = {
//                 itemCode: itemCode,
//                 itemName: itemName,
//                 category: category,
//                 quantity: stock,
//                 buyingPrice: buyingPrice,
//                 sellingPrice: sellingPrice,
//                 supplierName: supplierName,
//                 grnNumber: `GRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`
//               };
              
//               supplier.items.push(cartItem);
              
//               // Log cart add to supplier's change history
//               supplier.changeHistory = [...(supplier.changeHistory || []), {
//                 field: 'cart-add',
//                 oldValue: null,
//                 newValue: cartItem,
//                 changedBy: username,
//                 changedAt: new Date(),
//                 changeType: 'cart'
//               }];
              
//               await supplier.save();
//               console.log(`Added ${itemName} to ${supplierName}'s cart via Excel upload`);
//             } else {
//               console.log(`Item ${itemName} already exists in ${supplierName}'s cart`);
//             }
//           } else {
//             console.log(`Supplier ${supplierName} not found - item not added to cart`);
//           }
//         } catch (supplierError) {
//           console.error(`Error adding item to supplier cart: ${supplierError.message}`);
//           // Don't fail the entire upload for supplier cart errors
//         }
//       }
//     } catch (error) {
//       errors.push({ row: i + 1, error: error.message });
//     }
//   }

//   // Log the upload
//   try {
//     const log = new ExcelProduct({
//       filename: req.file.originalname,
//       uploadedBy: username,
//       products: results
//     });
//     await log.save();
//   } catch (logError) {
//     console.error('Error logging Excel upload:', logError);
//   }

//   res.json({
//     message: 'Excel upload completed',
//     totalProcessed: jsonData.length,
//     successful: results.length,
//     errors: errors.length,
//     results,
//     errors
//   });

// } catch (error) {
//   console.error('Excel upload error:', error);
//   res.status(500).json({ message: 'Error processing Excel file: ' + error.message });
// }
// });

// POST: Log Excel upload
router.post('/excel-upload-log', async (req, res) => {
  try {
    console.log('Received Excel upload log:', req.body); // Debug log
    const { filename, uploadedBy, products } = req.body;
    if (!filename || !uploadedBy || !Array.isArray(products)) {
      return res.status(400).json({ message: 'Missing required fields for Excel upload log.' });
    }
    const log = new ExcelProduct({ filename, uploadedBy, products });
    await log.save();
    res.status(201).json({ message: 'Excel upload logged successfully.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN: Backfill stock changeHistory for all products
router.post('/backfill-stock-history', async (req, res) => {
  try {
    const products = await Product.find();
    let updatedCount = 0;
    for (const product of products) {
      let history = product.changeHistory || [];
      let prevStock = null;
      let newHistory = [];
      // Find the initial stock value
      if (history.length > 0 && history[0].field === 'creation' && history[0].newValue && history[0].newValue.stock !== undefined) {
        prevStock = history[0].newValue.stock;
      } else if (product.stock !== undefined) {
        prevStock = product.stock;
      }
      for (let i = 0; i < history.length; i++) {
        const log = history[i];
        if (log.field === 'stock' && log.changeType !== 'update') {
          // Convert old stock logs to 'update'
          newHistory.push({ ...log, changeType: 'update' });
          prevStock = log.newValue;
        } else if (log.field === 'stock') {
          newHistory.push(log);
          prevStock = log.newValue;
        } else {
          newHistory.push(log);
        }
        // If the next log is not a stock change, but the stock value changed, add a synthetic log
        if (i < history.length - 1 && history[i + 1].field !== 'stock' && product.stock !== prevStock) {
          newHistory.push({
            field: 'stock',
            oldValue: prevStock,
            newValue: product.stock,
            changedBy: 'system-backfill',
            changedAt: new Date(),
            changeType: 'update'
          });
          prevStock = product.stock;
        }
      }
      // If no stock change logs exist but stock changed from initial, add one
      if (!history.some(log => log.field === 'stock') && prevStock !== product.stock) {
        newHistory.push({
          field: 'stock',
          oldValue: prevStock,
          newValue: product.stock,
          changedBy: 'system-backfill',
          changedAt: new Date(),
          changeType: 'update'
        });
      }
      product.changeHistory = newHistory;
      await product.save();
      updatedCount++;
    }
    res.json({ message: `Backfilled stock changeHistory for ${updatedCount} products.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;