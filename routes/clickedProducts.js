const express = require('express');
const router = express.Router();
const ClickedProduct = require('../models/ClickedProduct');
const Product = require('../models/Product');

// GET: Get all clicked products
router.get('/', async (req, res) => {
  try {
    const clickedProducts = await ClickedProduct.find()
      .sort({ clickedAt: -1 }) // Sort by most recent first
      .limit(100); // Limit to last 100 records
    
    res.json(clickedProducts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST: Mark a product as clicked for Add Product
router.post('/click/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const clickedBy = req.body.clickedBy || 'system';
    
    // Find the product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if product is already clicked
    if (product.clickedForAdd) {
      return res.status(400).json({ message: 'Product already clicked for Add Product' });
    }

    // Create clicked product record
    const clickedProduct = new ClickedProduct({
      productId: product._id,
      itemCode: product.itemCode,
      itemName: product.itemName,
      category: product.category,
      buyingPrice: product.buyingPrice,
      sellingPrice: product.sellingPrice,
      stock: product.stock,
      supplierName: product.supplierName,
      clickedBy: clickedBy
    });

    await clickedProduct.save();

    // Update the original product to mark it as clicked
    product.clickedForAdd = true;
    product.clickedAt = new Date();
    product.clickedBy = clickedBy;
    await product.save();

    res.json({ 
      message: 'Product marked as clicked for Add Product',
      clickedProduct: clickedProduct
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET: Get products that are not clicked (for display in product list)
router.get('/available', async (req, res) => {
  try {
    const availableProducts = await Product.find({
      deleted: { $ne: true },
      visible: true,
      clickedForAdd: { $ne: true }
    }).sort({ createdAt: -1 });
    
    res.json(availableProducts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE: Remove clicked product record (for admin purposes)
router.delete('/:id', async (req, res) => {
  try {
    const clickedProduct = await ClickedProduct.findById(req.params.id);
    if (!clickedProduct) {
      return res.status(404).json({ message: 'Clicked product record not found' });
    }

    // Reset the original product's clicked status
    await Product.findByIdAndUpdate(clickedProduct.productId, {
      clickedForAdd: false,
      clickedAt: null,
      clickedBy: null
    });

    await clickedProduct.deleteOne();
    res.json({ message: 'Clicked product record removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 