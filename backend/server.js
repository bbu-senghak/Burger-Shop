const express = require('express');
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./loadEnv');
const { hashPassword, verifyPassword, signJwt, verifyJwt, isPasswordHashed } = require('./auth');
const { populateItems } = require('./items');

loadEnv(path.resolve(__dirname, '.env'));

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const dbConfig = {
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    connectString: process.env.DB_CONNECT_STRING || ''
};

const authConfig = {
    jwtSecret: process.env.JWT_SECRET || 'replace-this-jwt-secret',
    jwtTtlSeconds: Number.parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '28800', 10),
    defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
    defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
    defaultStaffUsername: process.env.DEFAULT_STAFF_USERNAME || 'staff',
    defaultStaffPassword: process.env.DEFAULT_STAFF_PASSWORD || 'staff123'
};

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    return next();
});

function assertConfig() {
    const missing = [];
    if (!dbConfig.user) missing.push('DB_USER');
    if (!dbConfig.password) missing.push('DB_PASSWORD');
    if (!dbConfig.connectString) missing.push('DB_CONNECT_STRING');
    if (!authConfig.jwtSecret || authConfig.jwtSecret === 'replace-this-jwt-secret') missing.push('JWT_SECRET');

    if (missing.length > 0) {
        throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
}

function parseBearerToken(authorizationHeader) {
    if (!authorizationHeader) return null;
    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token;
}

function authenticateToken(req, res, next) {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
        return res.status(401).json({ success: false, message: 'Missing authentication token' });
    }

    const payload = verifyJwt(token, authConfig.jwtSecret);
    if (!payload) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    req.user = payload;
    return next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        return next();
    };
}

// --- Mongoose Schemas ---
const AdminSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, default: 'Admin' },
    role: { type: String, default: 'admin' }
});
const Admin = mongoose.model('Admin', AdminSchema);

const StaffSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String },
    mobile_number: { type: String },
    address: { type: String },
    nid: { type: String },
    is_active: { type: String, default: 'Y' },
    role: { type: String, default: 'staff' }
});
const Staff = mongoose.model('Staff', StaffSchema);

const CustomerSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }
});
const Customer = mongoose.model('Customer', CustomerSchema);

const StockSchema = new mongoose.Schema({
    item_code: { type: String, required: true, unique: true },
    category: { type: String },
    item_name: { type: String },
    price: { type: Number },
    discount: { type: Number, default: 0 },
    image: { type: String },
    expiry_date: { type: Date },
    quantity: { type: Number, default: 0 }
});
const Stock = mongoose.model('Stock', StockSchema);

const OrderItemSchema = new mongoose.Schema({
    item_code: String,
    quantity: Number,
    price: Number
});

const OrderSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    order_date: { type: Date, default: Date.now },
    customer_id: { type: String, ref: 'Customer' },
    total_price: Number,
    discount: Number,
    final_price: Number,
    items: [OrderItemSchema]
});
const Order = mongoose.model('Order', OrderSchema);

const ContactMessageSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    name: String,
    email: String,
    phone_number: String,
    subject: String,
    message: String,
    created_at: { type: Date, default: Date.now }
});
const ContactMessage = mongoose.model('ContactMessage', ContactMessageSchema);

// Mock getConnection for unmigrated routes to prevent crash
async function getConnection() {
    return {
        execute: async () => { throw new Error('Route not migrated to MongoDB yet! Please rewrite to use Mongoose.'); },
        commit: async () => {},
        rollback: async () => {},
        close: async () => {}
    };
}

async function setupDatabase() {
    try {
        await mongoose.connect(dbConfig.mongoUri);
        console.log('Successfully connected to MongoDB');

        // Ensure default Admin
        const adminExists = await Admin.findOne({ username: authConfig.defaultAdminUsername });
        if (!adminExists) {
            await Admin.create({
                username: authConfig.defaultAdminUsername,
                password: hashPassword(authConfig.defaultAdminPassword),
                name: 'Admin'
            });
        } else if (!isPasswordHashed(adminExists.password)) {
            adminExists.password = hashPassword(adminExists.password);
            await adminExists.save();
        }

        // Ensure default Staff
        const staffExists = await Staff.findOne({ username: authConfig.defaultStaffUsername });
        if (!staffExists) {
            await Staff.create({
                username: authConfig.defaultStaffUsername,
                password: hashPassword(authConfig.defaultStaffPassword),
                name: 'Default Staff'
            });
        } else if (!isPasswordHashed(staffExists.password)) {
            staffExists.password = hashPassword(staffExists.password);
            await staffExists.save();
        }
        
        // Safely test populateItems locally
        const mockConn = await getConnection();
        await populateItems(mockConn).catch(() => console.warn('populateItems pending MongoDB migration'));
    } catch (err) {
        console.error('Database setup failed:', err);
        throw err;
    }
}

async function testConnection() {
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('MongoDB connection test successful.');
        } else {
            throw new Error('Not connected to MongoDB');
        }
    } catch (err) {
        console.error('MongoDB connection test failed:', err);
    }
}

function normalizeStaffUsername(rawName, fallbackSuffix) {
    const normalized = (rawName || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    if (normalized) return normalized;
    return `staff${fallbackSuffix}`;
}

function normalizeNumericId(value) {
    if (!value) return null;
    const str = String(value).trim();
    return str || null;
}

async function ensureUniqueStaffUsername(baseUsername) {
    let username = baseUsername;
    let counter = 1;
    while (true) {
        const existingStaff = await Staff.exists({ username });
        const existingAdmin = await Admin.exists({ username });
        if (!existingStaff && !existingAdmin) return username;
        username = `${baseUsername}${counter}`;
        counter += 1;
    }
}

async function staffNameExists(staffName, excludeStaffId = null) {
    const normalizedName = String(staffName || '').trim();
    if (!normalizedName) return false;

    const query = { name: { $regex: new RegExp(`^${normalizedName}$`, 'i') } };
    if (excludeStaffId) {
        query._id = { $ne: excludeStaffId };
    }
    const count = await Staff.countDocuments(query);
    return count > 0;
}

function toOrderResponse(ordersRows) {
    const grouped = new Map();
    for (const row of ordersRows) {
        const orderId = row.ORDER_ID;
        if (!grouped.has(orderId)) {
            grouped.set(orderId, {
                orderId,
                timestamp: row.ORDER_DATE ? new Date(row.ORDER_DATE).toISOString() : null,
                customerCode: String(row.CUSTOMER_ID),
                customerName: row.CUSTOMER_NAME || 'Unknown',
                items: [],
                totalPrice: Number(row.TOTAL_PRICE || 0),
                discountPrice: Number(row.DISCOUNT || 0),
                finalTotalPrice: Number(row.FINAL_PRICE || 0)
            });
        }

        if (row.ITEM_CODE) {
            grouped.get(orderId).items.push({
                itemCode: row.ITEM_CODE,
                name: row.ITEM_NAME || row.ITEM_CODE,
                price: Number(row.ITEM_PRICE || 0),
                quantity: Number(row.QUANTITY || 0)
            });
        }
    }

    return Array.from(grouped.values());
}

async function fetchStaffById(staffId) {
    const staff = await Staff.findById(staffId).lean();
    if (!staff) return null;
    return {
        STAFF_ID: staff._id,
        USERNAME: staff.username,
        NAME: staff.name,
        MOBILE_NUMBER: staff.mobile_number,
        ADDRESS: staff.address,
        NID: staff.nid,
        IS_ACTIVE: staff.is_active,
        ROLE: staff.role
    };
}

async function fetchCustomerById(connection, customerId) {
    const result = await connection.execute(
        `SELECT customer_id, name, email, phone
         FROM customers
         WHERE customer_id = :id`,
        { id: customerId }
    );
    return result.rows[0] || null;
}

async function fetchItemByCode(connection, itemCode) {
    const result = await connection.execute(
        `SELECT item_code, category, item_name, price, discount, image, expiry_date, quantity
         FROM stock
         WHERE UPPER(TRIM(item_code)) = UPPER(TRIM(:itemCode))`,
        { itemCode }
    );
    return result.rows[0] || null;
}

async function fetchOrders(connection, { customerId, orderId } = {}) {
    const where = [];
    const binds = {};

    if (customerId) {
        where.push('o.customer_id = :customerId');
        binds.customerId = Number(customerId);
    }
    if (orderId) {
        where.push('o.order_id = :orderId');
        binds.orderId = Number(orderId);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const result = await connection.execute(
        `SELECT
            o.order_id,
            o.order_date,
            o.customer_id,
            c.name AS customer_name,
            o.total_price,
            o.discount,
            o.final_price,
            oi.item_code,
            oi.quantity,
            oi.price AS item_price,
            NVL(i.item_name, oi.item_code) AS item_name
         FROM orders o
         LEFT JOIN customers c ON c.customer_id = o.customer_id
         LEFT JOIN order_items oi ON oi.order_id = o.order_id
         LEFT JOIN stock i ON i.item_code = oi.item_code
         ${whereClause}
         ORDER BY o.order_date DESC, o.order_id DESC, oi.order_item_id ASC`,
        binds
    );

    return toOrderResponse(result.rows);
}

function processAndSaveImage(base64Data, itemCode, category) {
    if (!base64Data || typeof base64Data !== 'string') {
        return base64Data;
    }

    // If it's a local file path pasted by the user, format it to a relative web path
    const assetIndex = base64Data.replace(/\\/g, '/').indexOf('/asset/img/items/');
    if (!base64Data.startsWith('data:') && assetIndex !== -1) {
        return '.' + base64Data.replace(/\\/g, '/').substring(assetIndex);
    }

    if (!base64Data.startsWith('data:')) {
        return base64Data;
    }

    const matches = base64Data.match(/^data:([a-zA-Z0-9-+\/]+)(?:;[^,]*)?;base64,([\s\S]+)$/);
    if (!matches || matches.length !== 3) {
        throw new Error('Invalid base64 image string');
    }

    let mimeType = matches[1];
    let ext = mimeType.includes('/') ? mimeType.split('/')[1] : mimeType;
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'octet-stream') ext = 'jpg'; // fallback
    const data = Buffer.from(matches[2], 'base64');
    
    // Use the selected category folder or default to 'other'
    const categoryFolder = String(category || 'other').toLowerCase().trim();
    const fileName = `${String(itemCode).toLowerCase()}-${Date.now()}.${ext}`;
    
    const dirPath = path.resolve(__dirname, '..', 'frontend', 'asset', 'img', 'items', categoryFolder);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    
    const filePath = path.join(dirPath, fileName);
    fs.writeFileSync(filePath, data);
    
    return `./asset/img/items/${categoryFolder}/${fileName}`;
}

app.post('/api/login', async (req, res) => {
    const { category, username, password } = req.body;

    if (!category || !username || !password) {
        return res.status(400).json({ success: false, message: 'Category, username, and password are required' });
    }
    if (!['admin', 'staff'].includes(category)) {
        return res.status(400).json({ success: false, message: 'Invalid category' });
    }

    try {
        let user;
        if (category === 'admin') {
            const admin = await Admin.findOne({ username }).lean();
            if (admin) {
                user = { USER_ID: admin._id, USERNAME: admin.username, PASSWORD: admin.password, IS_ACTIVE: 'Y' };
            } else {
                const staffAdmin = await Staff.findOne({ username, role: 'admin' }).lean();
                if (staffAdmin) {
                    user = { USER_ID: staffAdmin._id, USERNAME: staffAdmin.username, PASSWORD: staffAdmin.password, IS_ACTIVE: staffAdmin.is_active || 'Y' };
                }
            }
        } else {
            const staff = await Staff.findOne({ username, role: { $in: ['staff', null, ''] } }).lean();
            if (staff) {
                user = { USER_ID: staff._id, USERNAME: staff.username, PASSWORD: staff.password, IS_ACTIVE: staff.is_active || 'Y' };
            }
        }

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (user.IS_ACTIVE && user.IS_ACTIVE !== 'Y') {
            return res.status(403).json({ success: false, message: 'Account is disabled. Please contact admin.' });
        }
        const valid = verifyPassword(password, user.PASSWORD);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = signJwt(
            {
                sub: String(user.USER_ID),
                username: user.USERNAME,
                role: category
            },
            authConfig.jwtSecret,
            authConfig.jwtTtlSeconds
        );

        return res.json({
            success: true,
            message: 'Login successful',
            token,
            role: category,
            username: user.USERNAME
        });
    } catch (err) {
        console.error('Error during login:', err);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/staff', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { mobileNumber, staffName, staffUsername, staffAddress, role } = req.body;
    const staffNID = req.body.staffNID || req.body.staffNIC;
    const normalizedStaffName = String(staffName || '').trim();
    const normalizedUsername = String(staffUsername || '').trim();
    const staffRole = (role || 'staff').toLowerCase();
    if (!normalizedStaffName || !normalizedUsername || !mobileNumber || !staffAddress || !staffNID) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        const duplicate = await staffNameExists(normalizedStaffName);
        if (duplicate) {
            return res.status(409).json({ success: false, message: 'Staff name already exists. Please use a different name.' });
        }

        const usernameCheck = await Staff.exists({ username: normalizedUsername });
        const adminUsernameCheck = await Admin.exists({ username: normalizedUsername });
        if (usernameCheck || adminUsernameCheck) {
             return res.status(409).json({ success: false, message: 'Username already exists. Please use a different username.' });
        }

        const hashedPassword = hashPassword(authConfig.defaultStaffPassword);
        const newStaff = await Staff.create({
            username: normalizedUsername,
            password: hashedPassword,
            name: normalizedStaffName,
            mobile_number: mobileNumber,
            address: staffAddress,
            nid: staffNID,
            is_active: 'Y',
            role: staffRole
        });

        const verifiedStaff = await fetchStaffById(newStaff._id);
        if (!verifiedStaff) {
            return res.status(500).json({ success: false, message: 'Staff created but verification failed.' });
        }

        return res.status(201).json({
            success: true,
            message: 'Staff member added successfully.',
            staffId: verifiedStaff.STAFF_ID,
            staff: verifiedStaff,
            username: verifiedStaff.USERNAME,
            temporaryPassword: authConfig.defaultStaffPassword
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to add staff member.' });
    }
});

app.get('/api/staff', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    try {
        const staffList = await Staff.find().sort({ _id: 1 }).lean();
        const mappedStaff = staffList.map(staff => ({
            STAFF_ID: staff._id,
            USERNAME: staff.username,
            NAME: staff.name,
            MOBILE_NUMBER: staff.mobile_number,
            ADDRESS: staff.address,
            NID: staff.nid,
            IS_ACTIVE: staff.is_active,
            ROLE: staff.role
        }));
        return res.json(mappedStaff);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve staff.' });
    }
});

app.get('/api/staff/:id', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }

    try {
        const verifiedStaff = await fetchStaffById(staffId);
        if (!verifiedStaff) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }
        return res.json(verifiedStaff);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve staff details.' });
    }
});

app.put('/api/staff/:id', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }

    const { name, username, mobile_number, address, role } = req.body;
    const nid = req.body.nid || req.body.nic;
    const normalizedName = String(name || '').trim();
    const normalizedUsername = String(username || '').trim();
    const staffRole = (role || 'staff').toLowerCase();
    if (!normalizedName || !normalizedUsername || !mobile_number || !address || !nid) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    try {
        const duplicate = await staffNameExists(normalizedName, staffId);
        if (duplicate) {
            return res.status(409).json({ success: false, message: 'Staff name already exists. Please use a different name.' });
        }

        const usernameCheck = await Staff.exists({ username: normalizedUsername, _id: { $ne: staffId } });
        const adminUsernameCheck = await Admin.exists({ username: normalizedUsername });
        if (usernameCheck || adminUsernameCheck) {
             return res.status(409).json({ success: false, message: 'Username already exists. Please use a different username.' });
        }

        const updated = await Staff.findByIdAndUpdate(
            staffId,
            { name: normalizedName, username: normalizedUsername, mobile_number, address, nid, role: staffRole }
        );
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }
        const verifiedStaff = await fetchStaffById(staffId);
        if (!verifiedStaff) {
            return res.status(500).json({ success: false, message: 'Update applied but verification failed.' });
        }
        return res.json({ success: true, message: 'Staff member updated successfully.', staff: verifiedStaff });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to update staff member.' });
    }
});

app.put('/api/staff/:id/disable', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }

    try {
        const updated = await Staff.findByIdAndUpdate(staffId, { is_active: 'N' });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }

        const verifiedStaff = await fetchStaffById(staffId);
        if (!verifiedStaff || verifiedStaff.IS_ACTIVE !== 'N') {
            return res.status(500).json({ success: false, message: 'Disable verification failed.' });
        }

        return res.json({
            success: true,
            message: 'Staff member disabled successfully.',
            verified: true,
            staff: verifiedStaff
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to disable staff member.' });
    }
});

app.put('/api/staff/:id/enable', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }

    try {
        const updated = await Staff.findByIdAndUpdate(staffId, { is_active: 'Y' });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }

        const verifiedStaff = await fetchStaffById(staffId);
        if (!verifiedStaff || verifiedStaff.IS_ACTIVE !== 'Y') {
            return res.status(500).json({ success: false, message: 'Enable verification failed.' });
        }

        return res.json({
            success: true,
            message: 'Staff member enabled successfully.',
            verified: true,
            staff: verifiedStaff
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to enable staff member.' });
    }
});

app.put('/api/staff/:id/reset-password', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }

    try {
        const hashedPassword = hashPassword(authConfig.defaultStaffPassword);
        const updated = await Staff.findByIdAndUpdate(staffId, { password: hashedPassword });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }
        return res.json({ success: true, message: 'Staff password reset to default successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to reset staff password.' });
    }
});

app.put('/api/staff/me/change-password', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const staffId = normalizeNumericId(req.user.sub);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }
    
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    try {
        const hashedPassword = hashPassword(newPassword);
        let updated = null;
        if (req.user.role === 'admin') {
            updated = await Admin.findByIdAndUpdate(staffId, { password: hashedPassword });
            if (!updated) {
                 updated = await Staff.findByIdAndUpdate(staffId, { password: hashedPassword });
            }
        } else {
            updated = await Staff.findByIdAndUpdate(staffId, { password: hashedPassword });
        }
        if (!updated) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        return res.json({ success: true, message: 'Password changed successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
});

app.put('/api/staff/:id/change-password', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const staffId = normalizeNumericId(id);
    if (!staffId) {
        return res.status(400).json({ success: false, message: 'Invalid staff ID' });
    }
    
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    try {
        const hashedPassword = hashPassword(newPassword);
        const updated = await Staff.findByIdAndUpdate(staffId, { password: hashedPassword });
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }
        return res.json({ success: true, message: 'Staff password changed successfully.' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to change staff password.' });
    }
});

app.delete('/api/staff/:id', authenticateToken, requireRole('admin', 'staff'), async (_req, res) => {
    return res.status(405).json({
        success: false,
        message: 'Delete staff is disabled. Use Disable Staff action instead.'
    });
});

app.post('/api/customers', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { customerName, customerEmail, customerPhone } = req.body;
    if (!customerName || !customerEmail || !customerPhone) {
        return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    let connection;
    try {
        connection = await getConnection();
        const insertResult = await connection.execute(
            `INSERT INTO customers (name, email, phone)
             VALUES (:customerName, :customerEmail, :customerPhone)
             RETURNING customer_id INTO :outCustomerId`,
            {
                customerName,
                customerEmail,
                customerPhone,
                outCustomerId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            },
            { autoCommit: true }
        );

        const createdCustomerId = insertResult.outBinds.outCustomerId[0];
        const verifiedCustomer = await fetchCustomerById(connection, createdCustomerId);
        if (!verifiedCustomer) {
            return res.status(500).json({ success: false, message: 'Customer created but verification failed.' });
        }

        return res.status(201).json({
            success: true,
            message: 'Customer added successfully.',
            customerId: verifiedCustomer.CUSTOMER_ID,
            customer: verifiedCustomer
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to add customer.' });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

app.get('/api/customers', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT customer_id, name, email, phone FROM customers ORDER BY customer_id`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve customers.' });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

app.get('/api/customers/:id', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const customerId = normalizeNumericId(id);
    if (!customerId) {
        return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `SELECT customer_id, name, email, phone FROM customers WHERE customer_id = :id`,
            { id: customerId }
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve customer details.' });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

app.put('/api/customers/:id', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const customerId = normalizeNumericId(id);
    if (!customerId) {
        return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    const { name, email, phone } = req.body;
    let connection;
    try {
        connection = await getConnection();
        const result = await connection.execute(
            `UPDATE customers SET name = :name, email = :email, phone = :phone WHERE customer_id = :id`,
            { name, email, phone, id: customerId },
            { autoCommit: true }
        );
        if ((result.rowsAffected || 0) === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        const verifiedCustomer = await fetchCustomerById(connection, customerId);
        if (!verifiedCustomer) {
            return res.status(500).json({ success: false, message: 'Update applied but verification failed.' });
        }
        return res.json({ success: true, message: 'Customer updated successfully.', customer: verifiedCustomer });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to update customer.' });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

app.delete('/api/customers/:id', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { id } = req.params;
    const customerId = normalizeNumericId(id);
    if (!customerId) {
        return res.status(400).json({ success: false, message: 'Invalid customer ID' });
    }
    let connection;
    try {
        connection = await getConnection();
        const existsBeforeDelete = await connection.execute(
            `SELECT COUNT(*) AS count FROM customers WHERE customer_id = :id`,
            { id: customerId }
        );
        if (Number(existsBeforeDelete.rows[0].COUNT) === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        // Remove dependent order rows first, then remove customer.
        const deletedOrderItems = await connection.execute(
            `DELETE FROM order_items
             WHERE order_id IN (
                SELECT order_id FROM orders WHERE customer_id = :id
             )`,
            { id: customerId }
        );
        const deletedOrders = await connection.execute(
            `DELETE FROM orders WHERE customer_id = :id`,
            { id: customerId }
        );
        const deletedCustomer = await connection.execute(
            `DELETE FROM customers WHERE customer_id = :id`,
            { id: customerId }
        );

        if ((deletedCustomer.rowsAffected || 0) === 0) {
            await connection.rollback();
            return res.status(500).json({ success: false, message: 'Customer delete failed.' });
        }

        const verifyCustomer = await connection.execute(
            `SELECT COUNT(*) AS count FROM customers WHERE customer_id = :id`,
            { id: customerId }
        );
        const verifyOrders = await connection.execute(
            `SELECT COUNT(*) AS count FROM orders WHERE customer_id = :id`,
            { id: customerId }
        );

        const customerStillExists = Number(verifyCustomer.rows[0].COUNT) > 0;
        const ordersStillExist = Number(verifyOrders.rows[0].COUNT) > 0;
        if (customerStillExists || ordersStillExist) {
            await connection.rollback();
            return res.status(500).json({ success: false, message: 'Delete verification failed.' });
        }

        await connection.commit();
        return res.json({
            success: true,
            message: 'Customer and related order history deleted successfully.',
            verified: true,
            deletedOrders: Number(deletedOrders.rowsAffected || 0),
            deletedOrderItems: Number(deletedOrderItems.rowsAffected || 0)
        });
    } catch (err) {
        console.error(err);
        if (connection) {
            await connection.rollback();
        }
        return res.status(500).json({ success: false, message: 'Failed to delete customer.' });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});

app.get('/api/public/items', async (req, res) => {
    const rawLimit = Number.parseInt(String(req.query.limit || '3'), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 24) : 3;
    const category = String(req.query.category || '').trim();

    try {
        const query = { quantity: { $gt: 0 } };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query.$or = [{ expiry_date: null }, { expiry_date: { $gte: today } }];
        
        if (category) {
            query.category = { $regex: new RegExp(`^${category}$`, 'i') };
        }

        const items = await Stock.find(query)
            .sort({ item_code: 1 })
            .limit(limit)
            .lean();
            
        return res.json(items.map(item => ({
            ITEM_CODE: item.item_code,
            CATEGORY: item.category,
            ITEM_NAME: item.item_name,
            PRICE: item.price,
            DISCOUNT: item.discount,
            IMAGE: item.image,
            EXPIRY_DATE: item.expiry_date,
            QUANTITY: item.quantity
        })));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve public menu items.' });
    }
});

app.post('/api/public/contact', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim();
    const phoneNumber = String(req.body?.phoneNumber || req.body?.phone || '').trim();
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !email || !phoneNumber || !subject || !message) {
        return res.status(400).json({ success: false, message: 'Please complete all contact fields.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
    }

    if (!/^[0-9+\-\s()]{7,20}$/.test(phoneNumber)) {
        return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    }

    if (name.length > 255 || email.length > 255 || phoneNumber.length > 20 || subject.length > 255 || message.length > 4000) {
        return res.status(400).json({ success: false, message: 'Contact message is too long.' });
    }

    try {
        const msg = await ContactMessage.create({
            name, email, phone_number: phoneNumber, subject, message
        });
        return res.status(201).json({
            success: true,
            message: 'Message sent successfully. Our team will contact you soon.',
            messageId: msg._id
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to send contact message.' });
    }
});

app.get('/api/contact-messages', authenticateToken, requireRole('admin', 'staff'), async (_req, res) => {
    try {
        const msgs = await ContactMessage.find().sort({ created_at: -1 }).lean();
        return res.json({
            success: true,
            messages: msgs.map(m => ({
                MESSAGE_ID: m._id,
                NAME: m.name,
                EMAIL: m.email,
                PHONE_NUMBER: m.phone_number,
                SUBJECT: m.subject,
                MESSAGE: m.message,
                CREATED_AT: m.created_at
            }))
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve contact messages.' });
    }
});

app.get('/api/items', authenticateToken, requireRole('admin', 'staff'), async (_req, res) => {
    try {
        const items = await Stock.find().sort({ item_code: 1 }).lean();
        return res.json(items.map(item => ({
            ITEM_CODE: item.item_code,
            CATEGORY: item.category,
            ITEM_NAME: item.item_name,
            PRICE: item.price,
            DISCOUNT: item.discount,
            IMAGE: item.image,
            EXPIRY_DATE: item.expiry_date,
            QUANTITY: item.quantity
        })));
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve stock items.' });
    }
});

app.post('/api/items', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    let { itemCode, category, itemName, price, discount, image, expiryDate, quantity } = req.body;
    if (!itemCode || !category || !itemName || price === undefined || price === null || !image) {
        return res.status(400).json({ success: false, message: 'Missing required stock fields.' });
    }

    const parsedExpiry = expiryDate ? new Date(expiryDate) : null;
    if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiry date.' });
    }

    try {
        image = processAndSaveImage(image, itemCode, category);
    } catch (err) {
        return res.status(400).json({ success: false, message: 'Image processing failed: ' + err.message });
    }

    try {
        const normalizedCode = String(itemCode).trim();
        const existing = await Stock.findOne({ item_code: new RegExp(`^${normalizedCode}$`, 'i') });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Item code already exists.' });
        }

        await Stock.create({
            item_code: normalizedCode,
            category,
            item_name: itemName,
            price: Number(price),
            discount: Number(discount || 0),
            image,
            expiry_date: parsedExpiry,
            quantity: Number(quantity || 0)
        });

        const created = await fetchItemByCode(normalizedCode);
        if (!created) {
            return res.status(500).json({ success: false, message: 'Stock created but verification failed.' });
        }
        return res.status(201).json({ success: true, message: 'Stock item created successfully.', item: created });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to create stock item.' });
    }
});

app.put('/api/items/:itemCode', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const originalCode = String(req.params.itemCode || '').trim();
    let { itemCode, category, itemName, price, discount, image, expiryDate, quantity } = req.body;
    const newCode = String(itemCode || originalCode).trim();
    if (!originalCode || !newCode || !category || !itemName || price === undefined || price === null || !image) {
        return res.status(400).json({ success: false, message: 'Missing required stock fields.' });
    }

    const parsedExpiry = expiryDate ? new Date(expiryDate) : null;
    if (parsedExpiry && Number.isNaN(parsedExpiry.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid expiry date.' });
    }

    try {
        image = processAndSaveImage(image, newCode, category);
    } catch (err) {
        return res.status(400).json({ success: false, message: 'Image processing failed: ' + err.message });
    }

    try {
        if (newCode.toLowerCase() !== originalCode.toLowerCase()) {
            const existing = await Stock.findOne({ item_code: new RegExp(`^${newCode}$`, 'i') });
            if (existing) {
                return res.status(409).json({ success: false, message: 'Item code already exists.' });
            }
        }

        const updated = await Stock.findOneAndUpdate(
            { item_code: new RegExp(`^${originalCode}$`, 'i') },
            {
                item_code: newCode,
                category,
                item_name: itemName,
                price: Number(price),
                discount: Number(discount || 0),
                image,
                expiry_date: parsedExpiry,
                quantity: Number(quantity || 0)
            }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Stock item not found.' });
        }

        const verifiedItem = await fetchItemByCode(newCode);
        return res.json({ success: true, message: 'Stock item updated successfully.', item: verifiedItem });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to update stock item.' });
    }
});

app.delete('/api/items/:itemCode', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const itemCode = String(req.params.itemCode || '').trim();
    if (!itemCode) {
        return res.status(400).json({ success: false, message: 'Invalid item code.' });
    }

    try {
        const deleted = await Stock.findOneAndDelete({ item_code: new RegExp(`^${itemCode}$`, 'i') });
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Stock item not found.' });
        }

        return res.json({ success: true, message: 'Stock item deleted successfully.', verified: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to delete stock item.' });
    }
});

app.post('/api/orders', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { customerId, items, totalPrice, discountPrice, finalTotalPrice, orderDate } = req.body;
    if (!customerId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid order payload' });
    }

    try {
        const parsedOrderDate = orderDate ? new Date(orderDate) : new Date();
        const finalOrderDate = Number.isNaN(parsedOrderDate.getTime()) ? new Date() : parsedOrderDate;

        const newOrder = await Order.create({
            order_date: finalOrderDate,
            customer_id: customerId,
            total_price: Number(totalPrice || 0),
            discount: Number(discountPrice || 0),
            final_price: Number(finalTotalPrice || 0),
            items: items.map(item => ({
                item_code: item.itemCode,
                quantity: Number(item.quantity || 0),
                price: Number(item.price || 0)
            }))
        });

        for (const item of items) {
            await Stock.findOneAndUpdate(
                { item_code: item.itemCode },
                { $inc: { quantity: -Number(item.quantity || 0) } }
            );
        }

        const createdOrders = await fetchOrders({ orderId: newOrder._id });
        return res.status(201).json(createdOrders[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to create order.' });
    }
});

app.get('/api/orders', authenticateToken, requireRole('admin', 'staff'), async (req, res) => {
    const { customerId } = req.query;
    try {
        const orders = await fetchOrders({ customerId });
        return res.json(orders);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: 'Failed to retrieve orders.' });
    }
});

app.get('/', (_req, res) => {
    res.send('Backend is running!');
});

async function start() {
    assertConfig();
    await setupDatabase();
    await testConnection();
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
    });
}

if (require.main === module) {
    start().catch((err) => {
        console.error('Startup failed:', err.message);
        process.exit(1);
    });
}

module.exports = {
    app,
    start,
    parseBearerToken,
    toOrderResponse
};
