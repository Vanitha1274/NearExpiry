const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb'); 
const PORT = 3000;
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'NearXpirY';
const client = new MongoClient(MONGO_URI);
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

// ---------- Static File Serving ----------
function serveStatic(req, res) {
  const url = req.url === '/' ? '/coverpage.html' : req.url;
  const safePath = path.normalize(url.replace(/\?.*$/, '')).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(__dirname, safePath);
  const ext = path.extname(filePath);
  const type = MIME[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      return res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

// ---------- Helpers ----------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const json = JSON.parse(body || '{}');
        resolve(json);
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return { salt, hash };
}

function coll(db, role) {
  if (role === 'customer') return db.collection('customers');
  if (role === 'seller') return db.collection('sellers');
  if (role === 'ngo') return db.collection('ngos');
  throw new Error('Invalid role');
}

// ---------- Signup ----------
async function handleSignup(req, res) {
  try {
    const payload = await readJson(req);
    const role = payload.role;
    if (!role) throw new Error('Missing role');

    const requiredCommon = ['username', 'phone', 'password'];
    const roleSpecific = {
      customer: ['email', 'address'],
      seller: ['email', 'businessName', 'businessType', 'location'],
      ngo: ['organisation', 'location'],
    };

    const missingCommon = requiredCommon.filter(k => !payload[k] || String(payload[k]).trim() === '');
    if (missingCommon.length) throw new Error(`Missing: ${missingCommon.join(', ')}`);

    const reqRoleKeys = roleSpecific[role] || [];
    const missingRole = reqRoleKeys.filter(k => !payload[k] || String(payload[k]).trim() === '');
    if (missingRole.length) throw new Error(`Missing: ${missingRole.join(', ')}`);

    if (payload.confirm && payload.confirm !== payload.password) {
      throw new Error('Passwords do not match');
    }

    await client.connect();
    const db = client.db(DB_NAME);
    const collection = coll(db, role);

    const existing = await collection.findOne({ username: payload.username });
    if (existing) throw new Error('Username already exists');

    if (payload.email) {
      const existingEmail = await collection.findOne({ email: payload.email });
      if (existingEmail) throw new Error('Email already exists');
    }

    const { salt, hash } = hashPassword(payload.password);
    const doc = {
      ...payload,
      password: undefined,
      confirm: undefined,
      passwordHash: hash,
      salt,
      createdAt: new Date(),
    };

    await collection.insertOne(doc);
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Signup successful' }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message || 'Signup failed' }));
  }
}

// ---------- Login ----------
async function findUserByUsername(db, username) {
  const roles = [
    { role: 'customer', c: db.collection('customers') },
    { role: 'seller', c: db.collection('sellers') },
    { role: 'ngo', c: db.collection('ngos') },
  ];
  for (const r of roles) {
    const user = await r.c.findOne({ username });
    if (user) return { ...user, role: r.role };
  }
  return null;
}

async function handleLogin(req, res) {
  try {
    const { username, password } = await readJson(req);
    if (!username || !password) throw new Error('Missing username or password');

    await client.connect();
    const db = client.db(DB_NAME);
    const user = await findUserByUsername(db, username);
    if (!user) throw new Error('Invalid credentials');

    const { hash } = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) throw new Error('Invalid credentials');

    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Login successful',
      role: user.role,
      username: user.username,
    }));
  } catch (err) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message || 'Login failed' }));
  }
}

// ---------- Search ----------
async function handleSearch(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`); // ✅ fixed backtick
  const query = urlObj.searchParams.get('q') || '';

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const products = await db.collection('products').find({
      name: { $regex: query, $options: 'i' },
      expiryDays: { $gt: 7 }
    }).toArray();
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(products));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Search failed' }));
  }
}

// ---------- Category ----------
async function handleCategory(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const query = urlObj.searchParams.get('q') || '';

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const products = await db.collection('products').find({
      category: { $regex: query, $options: 'i' },
      expiryDays: { $gt: 7 }
    }).toArray();
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(products));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Category fetch failed' }));
  }
}

// ---------- Add Product ----------
async function handleAddProduct(req, res) {
  try {
    const data = await readJson(req);
    const required = ['name', 'image', 'expiryDays', 'discount', 'category', 'price', 'originalPrice'];
    const missing = required.filter(k => !data[k] || String(data[k]).trim() === '');
    if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);

    await client.connect();
    const db = client.db(DB_NAME);
    const result = await db.collection('products').insertOne({
      ...data,
      createdAt: new Date()
    });
    
    // Check if product needs immediate auto-donation
    if (data.expiryDays <= 7) {
      await db.collection('donations').insertOne({
        productName: data.name,
        quantity: data.quantity,
        expiryDays: data.expiryDays,
        category: data.category,
        sellerName: 'Auto-System',
        location: 'Contact seller for pickup',
        status: 'available',
        autoGenerated: true,
        originalProductId: result.insertedId,
        createdAt: new Date()
      });
      console.log(`Auto-donated immediately: ${data.name} (expires in ${data.expiryDays} days)`);
    }
    
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Product added successfully' }));
  } catch (err) {
    console.error('Add product error:', err.message);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message || 'Upload failed' }));
  }
}

// ---------- Create Order ----------
async function handleCreateOrder(req, res) {
  try {
    const order = await readJson(req);
    const { cart } = order;

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      throw new Error('Invalid cart data');
    }

    await client.connect();
    const db = client.db(DB_NAME);
    const products = db.collection('products');

    // Check stock for all items first
    for (const item of cart) {
      const product = await products.findOne({ name: item.name });
      if (!product) throw new Error(`Product ${item.name} not found`);
      if (product.quantity < item.quantity) {
        throw new Error(`Not enough stock for ${item.name}. Available: ${product.quantity}`);
      }
    }

    // Reduce quantities for all items
    for (const item of cart) {
      await products.updateOne(
        { name: item.name },
        { $inc: { quantity: -item.quantity } }
      );
    }

    await db.collection('orders').insertOne({
      ...order,
      status: 'confirmed',
      createdAt: new Date()
    });

    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Order placed successfully' }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message }));
  }
}

// ---------- Get Products with Stock ----------
async function handleGetProducts(req, res) {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const products = await db.collection('products').find({
      expiryDays: { $gt: 7 }
    }).toArray();
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(products));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Failed to get products' }));
  }
}

// ---------- Auto Donation System ----------
async function autoDonateCriticalProducts() {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    
    // Find products expiring in 7 days or less
    const criticalProducts = await db.collection('products').find({
      expiryDays: { $lte: 7 },
      quantity: { $gt: 0 }
    }).toArray();
    
    for (const product of criticalProducts) {
      // Check if already donated
      const existingDonation = await db.collection('donations').findOne({
        originalProductId: product._id,
        autoGenerated: true
      });
      
      if (!existingDonation) {
        // Auto-donate the product
        await db.collection('donations').insertOne({
          productName: product.name,
          quantity: product.quantity,
          expiryDays: product.expiryDays,
          category: product.category,
          sellerName: 'Auto-System',
          location: 'Contact seller for pickup',
          status: 'available',
          autoGenerated: true,
          originalProductId: product._id,
          createdAt: new Date()
        });
        
        console.log(`Auto-donated: ${product.name} (expires in ${product.expiryDays} days)`);
      }
    }
    
    await client.close();
  } catch (err) {
    console.error('Auto-donation error:', err);
  }
}

// Run auto-donation every hour
setInterval(autoDonateCriticalProducts, 60 * 60 * 1000);
// Run once on startup
autoDonateCriticalProducts();

// ---------- Donation APIs ----------
async function handleAddDonation(req, res) {
  try {
    const data = await readJson(req);
    const required = ['productName', 'quantity', 'expiryDays', 'sellerName', 'sellerPhone', 'location'];
    const missing = required.filter(k => !data[k] || String(data[k]).trim() === '');
    if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);

    await client.connect();
    const db = client.db(DB_NAME);
    await db.collection('donations').insertOne({
      ...data,
      status: 'available',
      autoGenerated: false,
      createdAt: new Date()
    });
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Donation added successfully' }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message }));
  }
}

async function handleGetDonations(req, res) {
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const donations = await db.collection('donations').find({ status: 'available' }).toArray();
    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(donations));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: 'Failed to get donations' }));
  }
}

async function handleClaimDonation(req, res) {
  try {
    const { donationId } = await readJson(req);
    if (!donationId) throw new Error('Missing donation ID');

    await client.connect();
    const db = client.db(DB_NAME);
    
    const result = await db.collection('donations').updateOne(
      { _id: new ObjectId(donationId), status: 'available' },
      { 
        $set: { 
          status: 'claimed', 
          claimedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      throw new Error('Donation not found or already claimed');
    }

    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Your requirement confirmed. Come and collect at location.' }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message }));
  }
}

async function handleDonateProduct(req, res) {
  try {
    const { productId, quantity } = await readJson(req);
    if (!productId || !quantity) throw new Error('Missing product ID or quantity');

    await client.connect();
    const db = client.db(DB_NAME);
    
    const product = await db.collection('products').findOne({ _id: new ObjectId(productId) });
    if (!product) throw new Error('Product not found');
    
    if (product.quantity < quantity) {
      throw new Error('Not enough stock to donate');
    }

    // Add to donations
    await db.collection('donations').insertOne({
      productName: product.name,
      quantity: quantity,
      expiryDays: product.expiryDays,
      category: product.category,
      sellerName: 'Seller',
      location: 'Contact for pickup',
      status: 'available',
      autoGenerated: false,
      originalProductId: product._id,
      createdAt: new Date()
    });

    // Reduce product quantity
    await db.collection('products').updateOne(
      { _id: new ObjectId(productId) },
      { $inc: { quantity: -quantity } }
    );

    await client.close();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Product donated successfully' }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, message: err.message }));
  }
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/signup')
    return handleSignup(req, res);
  if (req.method === 'POST' && req.url === '/api/login')
    return handleLogin(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/search'))
    return handleSearch(req, res);
  if (req.method === 'GET' && req.url.startsWith('/api/category'))
    return handleCategory(req, res);
  if (req.method === 'POST' && req.url === '/api/add-product')
    return handleAddProduct(req, res);
  if (req.method === 'POST' && req.url === '/api/orders')
    return handleCreateOrder(req, res);
  if (req.method === 'GET' && req.url === '/api/products')
    return handleGetProducts(req, res);

  if (req.method === 'POST' && req.url === '/api/add-donation')
    return handleAddDonation(req, res);
  if (req.method === 'POST' && req.url === '/api/donations')
    return handleAddDonation(req, res);
  if (req.method === 'GET' && req.url === '/api/donations')
    return handleGetDonations(req, res);
  if (req.method === 'POST' && req.url === '/api/claim-donation')
    return handleClaimDonation(req, res);
  if (req.method === 'POST' && req.url === '/api/donate-product')
    return handleDonateProduct(req, res);

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`NearXpiry server running at http://localhost:${PORT}`);
});

