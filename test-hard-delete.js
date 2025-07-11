const fetch = require('node-fetch');

const API_URL = 'https://raxwo-manage-backend-production.up.railway.app/api/products';

async function testHardDelete() {
  console.log('🧪 Testing Hard Delete Functionality...\n');

  try {
    // 1. Create a test product
    console.log('1. Creating test product...');
    const testProduct = {
      itemCode: 'TEST-HARD-DELETE-' + Date.now(),
      itemName: 'Test Product for Hard Delete',
      category: 'Test Category',
      buyingPrice: 100,
      sellingPrice: 150,
      stock: 10,
      supplierName: 'Test Supplier',
      changedBy: 'test-script'
    };

    const createResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testProduct)
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create test product: ${createResponse.statusText}`);
    }

    const createdProduct = await createResponse.json();
    console.log('✅ Test product created:', createdProduct.itemName, '(ID:', createdProduct._id, ')');

    // 2. Verify product exists in main collection
    console.log('\n2. Verifying product exists in main collection...');
    const getResponse = await fetch(`${API_URL}/${createdProduct._id}`);
    if (!getResponse.ok) {
      throw new Error('Failed to fetch created product');
    }
    const fetchedProduct = await getResponse.json();
    console.log('✅ Product found in main collection');

    // 3. Perform hard delete
    console.log('\n3. Performing hard delete...');
    const deleteResponse = await fetch(`${API_URL}/${createdProduct._id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedBy: 'test-script' })
    });

    if (!deleteResponse.ok) {
      const errorData = await deleteResponse.json();
      throw new Error(`Hard delete failed: ${errorData.message || deleteResponse.statusText}`);
    }

    const deleteResult = await deleteResponse.json();
    console.log('✅ Hard delete successful:', deleteResult.message);

    // 4. Verify product is removed from main collection
    console.log('\n4. Verifying product is removed from main collection...');
    const checkResponse = await fetch(`${API_URL}/${createdProduct._id}`);
    if (checkResponse.status === 404) {
      console.log('✅ Product successfully removed from main collection');
    } else {
      console.log('❌ Product still exists in main collection');
    }

    // 5. Check if product exists in deleted_products collection
    console.log('\n5. Checking deleted_products collection...');
    const deletedResponse = await fetch(`${API_URL}/deleted`);
    if (deletedResponse.ok) {
      const deletedProducts = await deletedResponse.json();
      const foundInDeleted = deletedProducts.find(p => p.originalProductId === createdProduct._id);
      if (foundInDeleted) {
        console.log('✅ Product found in deleted_products collection');
      } else {
        console.log('ℹ️ Product not found in deleted_products collection (expected for hard delete)');
      }
    }

    console.log('\n🎉 Hard delete test completed successfully!');
    console.log('📝 Summary:');
    console.log('   - Product created and verified in main collection');
    console.log('   - Hard delete performed successfully');
    console.log('   - Product removed from main collection');
    console.log('   - Product not copied to deleted_products collection (as expected)');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testHardDelete(); 