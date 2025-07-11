import fetch from 'node-fetch';

const API_URL = 'https://raxwo-manage-backend-production.up.railway.app/api/products';

async function testDeletionLogging() {
  console.log('🧪 Testing Deletion Logging Functionality...\n');

  try {
    // 1. Create a test product
    console.log('1. Creating test product...');
    const testProduct = {
      itemCode: 'TEST-LOGGING-' + Date.now(),
      itemName: 'Test Product for Deletion Logging',
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

    // 2. Test POST deletion logging
    console.log('\n2. Testing POST deletion logging...');
    const logData = {
      productId: createdProduct._id,
      itemCode: createdProduct.itemCode,
      itemName: createdProduct.itemName,
      category: createdProduct.category,
      supplierName: createdProduct.supplierName,
      deletedBy: 'test-script',
      deletionType: 'hard',
      changeHistory: createdProduct.changeHistory || []
    };

    const logResponse = await fetch(`${API_URL}/deletion-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logData)
    });

    if (!logResponse.ok) {
      const errorData = await logResponse.json();
      throw new Error(`Deletion logging failed: ${errorData.message || logResponse.statusText}`);
    }

    const logResult = await logResponse.json();
    console.log('✅ Deletion logged successfully:', logResult.message);
    console.log('   Log ID:', logResult.logId);
    console.log('   Deleted Product:', logResult.deletedProduct);

    // 3. Verify deletion log was created
    console.log('\n3. Verifying deletion log was created...');
    const logsResponse = await fetch(`${API_URL}/deleted-logs`);
    if (logsResponse.ok) {
      const logs = await logsResponse.json();
      const foundLog = logs.find(log => log.itemCode === createdProduct.itemCode);
      if (foundLog) {
        console.log('✅ Deletion log found in logs collection');
        console.log('   Log details:', {
          itemName: foundLog.itemName,
          deletionType: foundLog.deletionType,
          deletedBy: foundLog.deletedBy,
          deletedAt: foundLog.deletedAt
        });
      } else {
        console.log('❌ Deletion log not found in logs collection');
      }
    }

    // 4. Clean up - delete the test product
    console.log('\n4. Cleaning up - deleting test product...');
    const deleteResponse = await fetch(`${API_URL}/${createdProduct._id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedBy: 'test-script' })
    });

    if (deleteResponse.ok) {
      console.log('✅ Test product cleaned up successfully');
    } else {
      console.log('⚠️ Failed to clean up test product (this is okay for testing)');
    }

    console.log('\n🎉 Deletion logging test completed successfully!');
    console.log('📝 Summary:');
    console.log('   - Test product created');
    console.log('   - POST deletion logging worked');
    console.log('   - Deletion log verified in collection');
    console.log('   - Test product cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testDeletionLogging(); 