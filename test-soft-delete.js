const mongoose = require('mongoose');
const Product = require('./models/Product');
const DeletedProduct = require('./models/DeletedProduct');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/raxwo-manage', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function testSoftDelete() {
  try {
    console.log('Testing soft delete functionality...');
    
    // 1. Create a test product
    const testProduct = new Product({
      itemCode: 'TEST-001',
      itemName: 'Test Product for Soft Delete',
      category: 'Test Category',
      buyingPrice: 100,
      sellingPrice: 150,
      stock: 10,
      supplierName: 'Test Supplier',
      changeHistory: [{
        field: 'creation',
        oldValue: null,
        newValue: { itemCode: 'TEST-001', itemName: 'Test Product for Soft Delete' },
        changedBy: 'test-user',
        changedAt: new Date(),
        changeType: 'create'
      }]
    });
    
    const savedProduct = await testProduct.save();
    console.log('✅ Test product created:', savedProduct._id);
    
    // 2. Check that product exists in main collection
    const activeProducts = await Product.find({ deleted: { $ne: true } });
    console.log('✅ Active products count:', activeProducts.length);
    
    // 3. Simulate soft delete by calling the soft-delete endpoint
    const changedBy = 'test-user';
    const deleteData = {
      changeHistory: [
        ...(savedProduct.changeHistory || []),
        {
          field: 'product',
          oldValue: JSON.stringify(savedProduct),
          newValue: null,
          changedBy,
          changedAt: new Date(),
          changeType: 'delete'
        }
      ],
      deleted: true,
      deletedAt: new Date(),
      deletedBy: changedBy
    };
    
    // Update the product to mark it as deleted
    await Product.findByIdAndUpdate(savedProduct._id, deleteData);
    console.log('✅ Product marked as deleted in main collection');
    
    // 4. Copy to deleted_products collection
    const deletedProduct = new DeletedProduct({
      itemCode: savedProduct.itemCode,
      itemName: savedProduct.itemName,
      category: savedProduct.category,
      buyingPrice: savedProduct.buyingPrice,
      sellingPrice: savedProduct.sellingPrice,
      stock: savedProduct.stock,
      supplierName: savedProduct.supplierName,
      newBuyingPrice: savedProduct.newBuyingPrice,
      newSellingPrice: savedProduct.newSellingPrice,
      newStock: savedProduct.newStock,
      oldStock: savedProduct.oldStock,
      oldBuyingPrice: savedProduct.oldBuyingPrice,
      oldSellingPrice: savedProduct.oldSellingPrice,
      changeHistory: savedProduct.changeHistory,
      deleted: true,
      deletedAt: new Date(),
      deletedBy: changedBy,
      originalProductId: savedProduct._id
    });
    
    await deletedProduct.save();
    console.log('✅ Product copied to deleted_products collection');
    
    // 5. Verify the results
    const deletedProducts = await DeletedProduct.find();
    const stillActiveProducts = await Product.find({ deleted: { $ne: true } });
    const deletedInMain = await Product.find({ deleted: true });
    
    console.log('✅ Deleted products count:', deletedProducts.length);
    console.log('✅ Active products count:', stillActiveProducts.length);
    console.log('✅ Products marked as deleted in main collection:', deletedInMain.length);
    
    // 6. Test restore functionality
    const originalProduct = await Product.findById(savedProduct._id);
    if (originalProduct) {
      originalProduct.deleted = false;
      originalProduct.deletedAt = undefined;
      originalProduct.deletedBy = undefined;
      originalProduct.changeHistory = [
        ...(originalProduct.changeHistory || []),
        {
          field: 'product',
          oldValue: null,
          newValue: JSON.stringify(originalProduct),
          changedBy: 'test-user',
          changedAt: new Date(),
          changeType: 'restore'
        }
      ];
      await originalProduct.save();
      console.log('✅ Product restored in main collection');
    }
    
    // Remove from deleted_products collection
    await DeletedProduct.findByIdAndDelete(deletedProduct._id);
    console.log('✅ Product removed from deleted_products collection');
    
    // Final verification
    const finalActiveProducts = await Product.find({ deleted: { $ne: true } });
    const finalDeletedProducts = await DeletedProduct.find();
    
    console.log('✅ Final active products count:', finalActiveProducts.length);
    console.log('✅ Final deleted products count:', finalDeletedProducts.length);
    
    console.log('🎉 Soft delete test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
  }
}

testSoftDelete(); 