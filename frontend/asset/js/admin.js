const API_BASE_URL = 'http://localhost:3000';

function getAuthState() {
  return {
      token: localStorage.getItem('authToken'),
      role: localStorage.getItem('authRole')
  };
}

function clearAuthAndRedirect() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('authRole');
  localStorage.removeItem('authenticatedUser');
  sessionStorage.clear();
  window.location.href = 'login.html';
}

function normalizeNumericIdInput(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).trim().replace(/\D/g, '');
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatStaffDisplayId(id) {
  return `S${String(id).padStart(3, '0')}`;
}

function setItemImagePreview(previewElementId, imageValue) {
  const preview = document.getElementById(previewElementId);
  if (!preview) return;

  if (imageValue && String(imageValue).trim() !== '') {
      preview.src = imageValue;
      preview.style.display = 'block';
  } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
  }
}

let staffDirectory = [];
let customerDirectory = [];
let contactMessageDirectory = [];
const CONTACT_MESSAGES_POLL_MS = 30000;
const CONTACT_MESSAGES_BADGE_LIMIT = 99;
let currentSectionId = 'home';
let contactMessagesPollTimer = null;

function escapeHtmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatContactMessageDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString([], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function setContactMessageStatus(message, isError = false) {
    const statusElem = document.getElementById('contact-message-status');
    if (!statusElem) return;
    statusElem.textContent = message || '';
    statusElem.classList.toggle('error', Boolean(isError));
}

function parseContactMessageId(value) {
    const parsed = Number.parseInt(String(value ?? '').replace(/\D/g, ''), 10);
    if (Number.isNaN(parsed) || parsed <= 0) return 0;
    return parsed;
}

function getContactMessageStorageKey(suffix) {
    const role = getAuthState().role || 'user';
    return `hak_contact_messages_${suffix}_${role}`;
}

function getLatestContactMessageId(records) {
    return (Array.isArray(records) ? records : []).reduce((maxId, row) => {
        const messageId = parseContactMessageId(row && row.MESSAGE_ID);
        return messageId > maxId ? messageId : maxId;
    }, 0);
}

function getStoredReadMessageIds() {
    const key = getContactMessageStorageKey('read_ids');
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map(parseContactMessageId).filter((id) => id > 0));
    } catch (_error) {
        return new Set();
    }
}

function saveStoredReadMessageIds(readIdsSet) {
    const key = getContactMessageStorageKey('read_ids');
    const ids = Array.from(readIdsSet).filter((id) => id > 0).sort((a, b) => a - b);
    localStorage.setItem(key, JSON.stringify(ids));
}

function isContactMessageRead(messageId) {
    const parsedId = parseContactMessageId(messageId);
    if (!parsedId) return false;
    return getStoredReadMessageIds().has(parsedId);
}

function renderContactMessageBadge(unreadCount) {
    const badge = document.getElementById('contact-message-badge');
    if (!badge) return;

    const safeCount = Number.isFinite(Number(unreadCount)) ? Math.max(0, Number(unreadCount)) : 0;
    badge.textContent = safeCount > CONTACT_MESSAGES_BADGE_LIMIT
        ? `${CONTACT_MESSAGES_BADGE_LIMIT}+`
        : String(safeCount);
    
    if (safeCount > 0) {
        badge.classList.add('show');
        badge.setAttribute('aria-label', `${safeCount} unread message${safeCount === 1 ? '' : 's'}`);
    } else {
        badge.classList.remove('show');
    }
}

function syncContactMessageNotificationState(records, options = {}) {
    const {
        markAsSeen = false,
        suppressAlerts = true
    } = options;

    const messageRows = Array.isArray(records) ? records : [];
    const latestId = getLatestContactMessageId(messageRows);
    const notifiedKey = getContactMessageStorageKey('last_notified_id');
    let readIds = getStoredReadMessageIds();
    let lastNotifiedId = parseContactMessageId(sessionStorage.getItem(notifiedKey));

    if (markAsSeen && messageRows.length > 0) {
        messageRows.forEach((row) => {
            const id = parseContactMessageId(row && row.MESSAGE_ID);
            if (id > 0) readIds.add(id);
        });
        saveStoredReadMessageIds(readIds);
    }

    const unseenCount = messageRows.reduce((count, row) => {
        const messageId = parseContactMessageId(row && row.MESSAGE_ID);
        return messageId > 0 && !readIds.has(messageId) ? count + 1 : count;
    }, 0);

    renderContactMessageBadge(unseenCount);

    if (!suppressAlerts && unseenCount > 0) {
        if (latestId > lastNotifiedId) {
            if (lastNotifiedId > 0) {
                alert(`New customer message received! Unread messages increased to ${unseenCount}.`);
            } else {
                alert(`You have ${unseenCount} unread customer message(s).`);
            }
            sessionStorage.setItem(notifiedKey, String(latestId));
        }
    } else if (sessionStorage.getItem(notifiedKey) === null && latestId > 0) {
        sessionStorage.setItem(notifiedKey, String(latestId));
    }
}

function markContactMessageAsRead(messageId) {
    const parsedId = parseContactMessageId(messageId);
    if (!parsedId) return;

    const readIds = getStoredReadMessageIds();
    if (!readIds.has(parsedId)) {
        readIds.add(parsedId);
        saveStoredReadMessageIds(readIds);
    }

    const input = document.getElementById('contact-search-input');
    const keyword = input ? input.value : '';
    const rows = keyword ? filterContactMessages(keyword) : contactMessageDirectory;
    renderContactMessagesTableRows(rows);
    syncContactMessageNotificationState(contactMessageDirectory, {
        markAsSeen: false,
        suppressAlerts: true
    });
    setContactMessageStatus(`Message ${parsedId} marked as read.`);
}

function markContactMessageAsUnread(messageId) {
    const parsedId = parseContactMessageId(messageId);
    if (!parsedId) return;

    const readIds = getStoredReadMessageIds();
    if (readIds.has(parsedId)) {
        readIds.delete(parsedId);
        saveStoredReadMessageIds(readIds);
    }

    const input = document.getElementById('contact-search-input');
    const keyword = input ? input.value : '';
    const rows = keyword ? filterContactMessages(keyword) : contactMessageDirectory;
    renderContactMessagesTableRows(rows);
    syncContactMessageNotificationState(contactMessageDirectory, {
        markAsSeen: false,
        suppressAlerts: true
    });
    setContactMessageStatus(`Message ${parsedId} marked as unread.`);
}

function markAllContactMessagesAsRead() {
    const readIds = getStoredReadMessageIds();
    let changed = false;
    contactMessageDirectory.forEach((row) => {
        const id = parseContactMessageId(row.MESSAGE_ID);
        if (id > 0 && !readIds.has(id)) {
            readIds.add(id);
            changed = true;
        }
    });

    if (changed) {
        saveStoredReadMessageIds(readIds);
        const input = document.getElementById('contact-search-input');
        const keyword = input ? input.value : '';
        const rows = keyword ? filterContactMessages(keyword) : contactMessageDirectory;
        renderContactMessagesTableRows(rows);
        syncContactMessageNotificationState(contactMessageDirectory, { markAsSeen: false, suppressAlerts: true });
        setContactMessageStatus('All messages marked as read.');
    } else {
        setContactMessageStatus('No unread messages to mark.');
    }
}

function renderContactMessagesTableRows(messageRecords) {
    const table = document.getElementById('contact-messages-table');
    const countElem = document.getElementById('contact-message-count');
    if (!table) return;

    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const records = Array.isArray(messageRecords) ? messageRecords : [];
    if (countElem) {
        countElem.textContent = `Showing ${records.length} of ${contactMessageDirectory.length} messages`;
    }

    if (records.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="contact-message-empty">No messages found.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = records.map((row) => {
        const messageId = parseContactMessageId(row.MESSAGE_ID);
        const isRead = isContactMessageRead(messageId);
        const messageText = String(row.MESSAGE || '').trim();
        const preview = messageText.length > 160 ? `${messageText.slice(0, 157)}...` : messageText;
        return `
            <tr class="${isRead ? 'contact-message-read' : 'contact-message-unread'}">
                <td>${escapeHtmlText(row.MESSAGE_ID)}</td>
                <td>${escapeHtmlText(formatContactMessageDateTime(row.CREATED_AT))}</td>
                <td>${escapeHtmlText(row.NAME)}</td>
                <td>${escapeHtmlText(row.EMAIL)}</td>
                <td>${escapeHtmlText(row.PHONE_NUMBER || '-')}</td>
                <td>${escapeHtmlText(row.SUBJECT)}</td>
                <td title="${escapeHtmlText(messageText)}">${escapeHtmlText(preview)}</td>
                <td>
                    ${isRead 
                        ? `<button type="button" class="contact-read-btn" onclick="markContactMessageAsUnread(${messageId})" style="background-color: #64748b; color: white;">Mark Unread</button>` 
                        : `<button type="button" class="contact-read-btn" onclick="markContactMessageAsRead(${messageId})">Mark as Read</button>`
                    }
                </td>
            </tr>
        `;
    }).join('');
}

function filterContactMessages(searchText) {
    const keyword = String(searchText || '').trim().toLowerCase();
    if (!keyword) return contactMessageDirectory.slice();
    return contactMessageDirectory.filter((row) => {
        const values = [
            row.MESSAGE_ID,
            row.NAME,
            row.EMAIL,
            row.PHONE_NUMBER,
            row.SUBJECT,
            row.MESSAGE,
            formatContactMessageDateTime(row.CREATED_AT)
        ];
        return values.some((value) => String(value || '').toLowerCase().includes(keyword));
    });
}

async function fetchContactMessagesFromApi() {
    const response = await apiFetch(`${API_BASE_URL}/api/contact-messages`);
    const payload = await response.json();
    if (!response.ok || !payload.success || !Array.isArray(payload.messages)) {
        throw new Error((payload && payload.message) || 'Failed to load contact messages.');
    }
    return payload.messages.slice();
}

async function loadContactMessages(showError = false, options = {}) {
    const table = document.getElementById('contact-messages-table');
    if (!table) return;

    const {
        markAsSeen = false,
        suppressAlerts = true,
        silentStatus = false
    } = options;

    if (!silentStatus) {
        setContactMessageStatus('Loading messages from database...');
    }

    try {
        contactMessageDirectory = await fetchContactMessagesFromApi();

        const searchInput = document.getElementById('contact-search-input');
        const keyword = searchInput ? searchInput.value : '';
        const filteredRows = keyword ? filterContactMessages(keyword) : contactMessageDirectory;
        renderContactMessagesTableRows(filteredRows);

        syncContactMessageNotificationState(contactMessageDirectory, { markAsSeen, suppressAlerts });

        if (!silentStatus) {
            if (contactMessageDirectory.length === 0) {
                setContactMessageStatus('No messages received yet.');
            } else if (keyword) {
                setContactMessageStatus(`Search keyword: "${keyword}"`);
            } else {
                setContactMessageStatus('Messages synced from database.');
            }
        }
    } catch (error) {
        console.error('Contact messages load error:', error);
        if (!silentStatus || currentSectionId === 'contactMessages') {
            contactMessageDirectory = [];
            renderContactMessagesTableRows([]);
            setContactMessageStatus(`Load failed: ${error.message}`, true);
        }
        if (showError) {
            alert(`Failed to load contact messages: ${error.message}`);
        }
    }
}

function searchContactMessagesInView() {
    const input = document.getElementById('contact-search-input');
    const keyword = input ? input.value : '';
    const filtered = filterContactMessages(keyword);
    renderContactMessagesTableRows(filtered);
    setContactMessageStatus(keyword ? `Search keyword: "${keyword}"` : 'Showing all messages.');
}

function clearContactMessagesSearch() {
    const input = document.getElementById('contact-search-input');
    if (input) input.value = '';
    renderContactMessagesTableRows(contactMessageDirectory);
    setContactMessageStatus('Showing all messages.');
}

async function pollContactMessagesForNotifications(suppressAlerts = false) {
    const isContactSectionOpen = currentSectionId === 'contactMessages';
    if (isContactSectionOpen) {
        await loadContactMessages(false, {
            markAsSeen: false,
            suppressAlerts: suppressAlerts
        });
        return;
    }

    try {
        contactMessageDirectory = await fetchContactMessagesFromApi();
        syncContactMessageNotificationState(contactMessageDirectory, {
            markAsSeen: false,
            suppressAlerts
        });
    } catch (error) {
        console.error('Contact message poll error:', error);
    }
}

function startContactMessagesPolling() {
    if (contactMessagesPollTimer) return;

    pollContactMessagesForNotifications(false).catch((error) => {
        console.error(error);
    });

    contactMessagesPollTimer = window.setInterval(() => {
        pollContactMessagesForNotifications(false).catch((error) => {
            console.error(error);
        });
    }, CONTACT_MESSAGES_POLL_MS);
}

function refreshContactMessages() {
    loadContactMessages(true, {
        markAsSeen: false,
        suppressAlerts: true
    }).catch((error) => {
        console.error(error);
    });
}

function renderStaffSummary(filteredRecords) {
    const totalCountElem = document.getElementById('staffTotalCount');
    const activeCountElem = document.getElementById('staffActiveCount');
    const disabledCountElem = document.getElementById('staffDisabledCount');
    const hintElem = document.getElementById('staffSearchHint');

    const total = staffDirectory.length;
    const active = staffDirectory.filter((staff) => staff.IS_ACTIVE !== 'N').length;
    const disabled = total - active;
    const showing = Array.isArray(filteredRecords) ? filteredRecords.length : 0;

    if (totalCountElem) totalCountElem.textContent = String(total);
    if (activeCountElem) activeCountElem.textContent = String(active);
    if (disabledCountElem) disabledCountElem.textContent = String(disabled);
    if (hintElem) hintElem.textContent = `Showing ${showing} of ${total} staff`;
}

function renderStaffTableRows(staffRecords) {
    const staffListTable = document.getElementById('staffList');
    if (!staffListTable) return;

    const staffListBody = staffListTable.querySelector('tbody');
    if (!staffListBody) return;

    renderStaffSummary(staffRecords);

    if (!Array.isArray(staffRecords) || staffRecords.length === 0) {
        staffListBody.innerHTML = `
            <tr>
                <td colspan="7" class="staff-empty-row">No matching staff found. Try a different search.</td>
            </tr>
        `;
        return;
    }

    staffListBody.innerHTML = staffRecords.map(staff => {
        const statusActionButton = staff.IS_ACTIVE === 'N'
            ? `<button type="button" class="staff-row-btn enable" onclick="enableStaffFromView(${staff.STAFF_ID})"><i class="fa fa-check-circle"></i> Enable</button>`
            : `<button type="button" class="staff-row-btn disable" onclick="disableStaffFromView(${staff.STAFF_ID})"><i class="fa fa-ban"></i> Disable</button>`;

        return `
        <tr>
            <td>${formatStaffDisplayId(staff.STAFF_ID)}</td>
            <td>${staff.NAME || '-'}</td>
            <td>${staff.USERNAME || '-'}</td>
            <td><span class="staff-status-badge ${staff.ROLE === 'admin' ? 'active' : ''}">${String(staff.ROLE || 'staff').toUpperCase()}</span></td>
            <td>${staff.MOBILE_NUMBER || '-'}</td>
            <td>${staff.ADDRESS || '-'}</td>
            <td>${staff.NID || '-'}</td>
            <td><span class="staff-status-badge ${staff.IS_ACTIVE === 'N' ? 'disabled' : 'active'}">${staff.IS_ACTIVE === 'N' ? 'Disabled' : 'Active'}</span></td>
            <td class="staff-actions-cell">
                <button type="button" class="staff-row-btn update" onclick="openUpdateStaffFromView(${staff.STAFF_ID})"><i class="fa fa-pen"></i> Update</button>
                ${statusActionButton}
                <button type="button" class="staff-row-btn reset" onclick="resetStaffPassword(${staff.STAFF_ID})"><i class="fa fa-key"></i> Reset PW</button>
                <button type="button" class="staff-row-btn change-pw" onclick="changeStaffPassword(${staff.STAFF_ID})" style="background-color: #f59e0b;"><i class="fa fa-lock"></i> Change PW</button>
            </td>
        </tr>
    `}).join('');
}

function filterStaffRecords(searchText) {
    const keyword = String(searchText || '').trim().toLowerCase();
    if (!keyword) return staffDirectory.slice();

    return staffDirectory.filter((staff) => {
        const idText = formatStaffDisplayId(staff.STAFF_ID).toLowerCase();
        const numericId = String(staff.STAFF_ID || '').toLowerCase();
        const name = String(staff.NAME || '').toLowerCase();
        const username = String(staff.USERNAME || '').toLowerCase();
        const mobile = String(staff.MOBILE_NUMBER || '').toLowerCase();
        const address = String(staff.ADDRESS || '').toLowerCase();
        const nid = String(staff.NID || '').toLowerCase();
        const role = String(staff.ROLE || 'staff').toLowerCase();
        const status = String(staff.IS_ACTIVE === 'N' ? 'disabled' : 'active');
        return idText.includes(keyword)
            || numericId.includes(keyword)
            || name.includes(keyword)
            || username.includes(keyword)
            || mobile.includes(keyword)
            || address.includes(keyword)
            || nid.includes(keyword)
            || role.includes(keyword)
            || status.includes(keyword);
    });
}

async function apiFetch(url, options = {}) {
  const { token } = getAuthState();
  const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 || response.status === 403) {
      clearAuthAndRedirect();
      throw new Error('Unauthorized');
  }
  return response;
}

document.addEventListener('DOMContentLoaded', () => {
  const { token, role } = getAuthState();
  const currentPage = window.location.pathname.split('/').pop().split('.').shift();

  if (!token || role !== currentPage) {
      clearAuthAndRedirect();
      return;
  }
});

document.addEventListener('DOMContentLoaded', function() {
  showSection('home');
  startContactMessagesPolling();
});


function logout() {
  clearAuthAndRedirect();
}


function showSection(sectionId) {
    currentSectionId = sectionId;

    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        section.style.display = section.id === sectionId ? 'block' : 'none';
    });

    const staffButtons = document.querySelector('.staff-buttons');
    const customerButtons = document.querySelector('.customer-buttons');

   
    if (sectionId === 'staff') {
        if (staffButtons) staffButtons.style.display = 'block';
        if (customerButtons) customerButtons.style.display = 'none';
        renderStaffViewIntoSection();
    } else if (sectionId === 'customers') {
        if (staffButtons) staffButtons.style.display = 'none';
        if (customerButtons) customerButtons.style.display = 'block';
        renderCustomerViewIntoSection();
    } else if (sectionId === 'contactMessages') {
        if (staffButtons) staffButtons.style.display = 'none';
        if (customerButtons) customerButtons.style.display = 'none';
        loadContactMessages(false, {
            markAsSeen: false,
            suppressAlerts: true
        }).catch((error) => {
            console.error(error);
        });
    } else {
        if (staffButtons) staffButtons.style.display = 'none';
        if (customerButtons) customerButtons.style.display = 'none';
    }
}

function renderStaffViewIntoSection() {
    const staffModalContent = document.getElementById('staffModalContent');
    const viewTemplate = document.getElementById('viewStaff');
    if (!staffModalContent || !viewTemplate) {
        return;
    }

    staffModalContent.innerHTML = viewTemplate.innerHTML;
    viewAllStaff().catch((error) => {
        console.error('Render staff view error:', error);
        alert(`View staff failed: ${error.message}`);
    });
}

function renderCustomerViewIntoSection() {
    const customerModalContent = document.getElementById('customerModalContent');
    const viewTemplate = document.getElementById('viewCustomers');
    if (!customerModalContent || !viewTemplate) {
        return;
    }

    customerModalContent.innerHTML = viewTemplate.innerHTML;
    viewAllCustomers().catch((error) => {
        console.error('Render customer view error:', error);
        alert(`View customers failed: ${error.message}`);
    });
}

function showModalContent(modalId) {
    const staffModalContent = document.getElementById('staffModalContent');
    const customerModalContent = document.getElementById('customerModalContent');
    const templates = document.querySelectorAll('.modal-template');

    
    
    templates.forEach(template => {
        if (template.id === modalId) {
            if (modalId.includes('Staff')) {
                if (modalId === 'viewStaff') {
                    renderStaffViewIntoSection();
                    return;
                }

                staffModalContent.innerHTML = template.innerHTML;

                
                if (modalId === 'addStaff') {
                    // document.getElementById('staffId').value = generateStaffId();
                }

                
                if (modalId === 'viewStaff') {
                    viewAllStaff();
                }
            } else if (modalId.includes('Customer')) {
                if (modalId === 'viewCustomers') {
                    renderCustomerViewIntoSection();
                    return;
                }

                customerModalContent.innerHTML = template.innerHTML;

                
                if (modalId === 'addCustomer') {
                    // document.getElementById('customerId').value = generateCustomerId();
                }

            }
        }
    });

   
    const staffButtons = document.querySelector('.staff-buttons');
    const customerButtons = document.querySelector('.customer-buttons');
    if (modalId !== 'viewStaff' && modalId !== 'viewCustomers') {
        if (staffButtons) staffButtons.style.display = 'none';
        if (customerButtons) customerButtons.style.display = 'none';
    }
}




function toggleSidebar() {
    var sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('open');
}

function showStaffButtons() {
    const staffButtons = document.querySelector('.staff-buttons');
    if (staffButtons) {
        staffButtons.style.display = 'block';
    }
    renderStaffViewIntoSection();
}

function showCustomerButtons() {
    const customerButtons = document.querySelector('.customer-buttons');
    if (customerButtons) {
        customerButtons.style.display = 'block';
    }
    renderCustomerViewIntoSection();
}

async function addStaffMember() {
    try {
        const liveContainer = document.getElementById('staffModalContent');
        if (!liveContainer) return;
        const mobileNumber = liveContainer.querySelector('#mobileNumber').value;
        const staffName = liveContainer.querySelector('#staffName').value;
        const staffUsername = liveContainer.querySelector('#staffUsername').value;
        const staffAddress = liveContainer.querySelector('#staffAddress').value;
        const staffNID = liveContainer.querySelector('#staffNID').value;
        const role = liveContainer.querySelector('#staffRole').value;

        const response = await apiFetch(`${API_BASE_URL}/api/staff`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ mobileNumber, staffName, staffUsername, staffAddress, staffNID, role }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
            console.log('Added staff member:', { mobileNumber, staffName, staffAddress, staffNID });
            const liveForm = liveContainer.querySelector('#addStaffForm');
            if (liveForm) liveForm.reset();
            const defaultPassword = result.temporaryPassword || 'staff123';
            alert(`Staff added and verified in DB.\nID: ${formatStaffDisplayId(result.staffId)}\nUsername: ${result.username || staffUsername}\nDefault Password: ${defaultPassword}`);
            showStaffButtons();
        } else {
            alert(result.message || 'Failed to add staff member');
            console.error('Failed to add staff member', result);
        }
    } catch (error) {
        console.error('Add staff error:', error);
        alert(`Add staff failed: ${error.message}`);
    }
}

async function fetchAndShowStaff(action) {
    try {
        const liveContainer = document.getElementById('staffModalContent');
        if (!liveContainer) return;

        const staffIdRaw = liveContainer.querySelector('#' + action + 'StaffId').value;
        const staffId = normalizeNumericIdInput(staffIdRaw);
        if (!staffId) {
            alert('Invalid Staff ID. Please use format like 1 or S001.');
            return;
        }

        const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}`);
        if (!response.ok) {
            const errorData = await response.json();
            alert(errorData.message || 'Staff member not found');
            return;
        }

        const staff = await response.json();
        if (!staff) {
            alert('Staff member not found');
            return;
        }

        const detailsDiv = liveContainer.querySelector('#' + action + 'StaffDetails');
        detailsDiv.innerHTML = `
            <label for="${action}StaffRole">Role:</label>
            <select id="${action}StaffRole" name="${action}StaffRole" required>
                <option value="staff" ${staff.ROLE === 'staff' ? 'selected' : ''}>Staff</option>
                <option value="admin" ${staff.ROLE === 'admin' ? 'selected' : ''}>Admin</option>
            </select><br>
            <label for="${action}StaffUsername">Login Username:</label>
            <input type="text" id="${action}StaffUsername" name="${action}StaffUsername" value="${staff.USERNAME || ''}" required><br>
            <label for="${action}MobileNumber">Enter Mobile Number:</label>
            <input type="text" id="${action}MobileNumber" name="${action}MobileNumber" value="${staff.MOBILE_NUMBER}" required><br>
            <label for="${action}StaffName">Staff Member Name:</label>
            <input type="text" id="${action}StaffName" name="${action}StaffName" value="${staff.NAME}" required><br>
            <label for="${action}StaffAddress">Staff Member Address:</label>
            <input type="text" id="${action}StaffAddress" name="${action}StaffAddress" value="${staff.ADDRESS}" required><br>
            <label for="${action}StaffNID">Staff Member NID:</label>
            <input type="text" id="${action}StaffNID" name="${action}StaffNID" value="${staff.NID}" required><br>
        `;
    } catch (error) {
        console.error('Fetch staff error:', error);
        alert(`Fetch staff failed: ${error.message}`);
    }
}

async function updateStaffMember() {
    try {
        const liveContainer = document.getElementById('staffModalContent');
        if (!liveContainer) return;

        const staffIdRaw = liveContainer.querySelector('#updateStaffId').value;
        const staffId = normalizeNumericIdInput(staffIdRaw);
        const mobileNumber = liveContainer.querySelector('#updateMobileNumber').value;
        const staffName = liveContainer.querySelector('#updateStaffName').value;
        const staffUsername = liveContainer.querySelector('#updateStaffUsername').value;
        const staffAddress = liveContainer.querySelector('#updateStaffAddress').value;
        const staffNID = liveContainer.querySelector('#updateStaffNID').value;
        const role = liveContainer.querySelector('#updateStaffRole').value;

        if (!staffId) {
            alert('Invalid Staff ID. Please use format like 1 or S001.');
            return;
        }

        const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: staffName, username: staffUsername, mobile_number: mobileNumber, address: staffAddress, nid: staffNID, role }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
            console.log('Updated staff member:', { staffId, mobileNumber, staffName, staffAddress, staffNID });
            const liveForm = liveContainer.querySelector('#updateStaffForm');
            if (liveForm) liveForm.reset();
            liveContainer.querySelector('#updateStaffDetails').innerHTML = '';
            alert(`Staff updated and verified in DB: ${formatStaffDisplayId(result.staff.STAFF_ID)}`);
            showStaffButtons();
        } else {
            alert(result.message || 'Failed to update staff member');
            console.error('Failed to update staff member', result);
        }
    } catch (error) {
        console.error('Update staff error:', error);
        alert(`Update staff failed: ${error.message}`);
    }
}

async function disableStaffMember() {
    try {
        const liveContainer = document.getElementById('staffModalContent');
        if (!liveContainer) return;
        const staffIdRaw = liveContainer.querySelector('#deleteStaffId').value;
        const staffId = normalizeNumericIdInput(staffIdRaw);
        if (!staffId) {
            alert('Invalid Staff ID. Please use format like 1 or S001.');
            return;
        }

        const result = await disableStaffById(staffId);
        if (result.success) {
            console.log('Disabled staff member with ID:', staffId);
            const liveForm = liveContainer.querySelector('#deleteStaffForm');
            if (liveForm) liveForm.reset();
            alert(`Staff disabled and verified in DB: ${formatStaffDisplayId(staffId)}`);
            showStaffButtons();
        }
    } catch (error) {
        console.error('Disable staff error:', error);
        alert(`Disable staff failed: ${error.message}`);
    }
}

async function disableStaffById(staffId) {
    const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}/disable`, {
        method: 'PUT',
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to disable staff member');
    }
    return result;
}

async function enableStaffById(staffId) {
    const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}/enable`, {
        method: 'PUT',
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to enable staff member');
    }
    return result;
}

async function openUpdateStaffFromView(staffId) {
    showModalContent('updateStaff');
    const updateInput = document.getElementById('updateStaffId');
    if (!updateInput) {
        return;
    }
    updateInput.value = formatStaffDisplayId(staffId);
    await fetchAndShowStaff('update');
}

async function disableStaffFromView(staffId) {
    const staff = staffDirectory.find(entry => Number(entry.STAFF_ID) === Number(staffId));
    if (staff && staff.IS_ACTIVE === 'N') {
        alert(`Staff ${formatStaffDisplayId(staffId)} is already disabled.`);
        return;
    }

    if (!confirm(`Disable staff ${formatStaffDisplayId(staffId)}?`)) {
        return;
    }

    try {
        await disableStaffById(staffId);
        alert(`Staff disabled. Account can be enabled later with the same password.`);
        await viewAllStaff();
    } catch (error) {
        console.error('Disable staff from list error:', error);
        alert(`Disable staff failed: ${error.message}`);
    }
}

async function enableStaffFromView(staffId) {
    const staff = staffDirectory.find(entry => Number(entry.STAFF_ID) === Number(staffId));
    if (staff && staff.IS_ACTIVE !== 'N') {
        alert(`Staff ${formatStaffDisplayId(staffId)} is already active.`);
        return;
    }

    if (!confirm(`Enable staff ${formatStaffDisplayId(staffId)}?`)) {
        return;
    }

    try {
        await enableStaffById(staffId);
        alert(`Staff enabled. The original password remains unchanged.`);
        await viewAllStaff();
    } catch (error) {
        console.error('Enable staff from list error:', error);
        alert(`Enable staff failed: ${error.message}`);
    }
}

async function resetStaffPassword(staffId) {
    if (!confirm(`Are you sure you want to reset the password for staff ${formatStaffDisplayId(staffId)} to the default password?`)) {
        return;
    }
    try {
        const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}/reset-password`, { method: 'PUT' });
        const result = await response.json();
        if (response.ok && result.success) {
            alert('Password reset to default successfully.');
        } else {
            alert(result.message || 'Failed to reset password.');
        }
    } catch (error) {
        console.error('Reset password error:', error);
        alert(`Reset password failed: ${error.message}`);
    }
}

async function changeStaffPassword(staffId) {
    const newPassword = prompt(`Enter new custom password for staff ${formatStaffDisplayId(staffId)} (min 6 characters):`);
    if (newPassword === null) return; 
    if (!newPassword || newPassword.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/api/staff/${staffId}/change-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            alert(`Password for staff ${formatStaffDisplayId(staffId)} changed successfully.`);
        } else {
            alert(result.message || 'Failed to change staff password.');
        }
    } catch (error) {
        console.error('Change staff password error:', error);
        alert(`Change staff password failed: ${error.message}`);
    }
}

async function submitOwnPasswordChange() {
    const newPassword = document.getElementById('myNewPassword').value;

    if (!newPassword || newPassword.length < 6) {
        alert('Password must be at least 6 characters.');
        return;
    }

    try {
        const response = await apiFetch(`${API_BASE_URL}/api/staff/me/change-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword })
        });
        const result = await response.json();
        if (response.ok && result.success) {
            document.getElementById('ownChangePasswordForm').reset();
            alert('Password changed successfully. You will now be logged out. Please log in again with your new password.');
            clearAuthAndRedirect();
        } else {
            alert(result.message || 'Failed to change password.');
        }
    } catch (error) {
        console.error('Change password error:', error);
        alert(`Change password failed: ${error.message}`);
    }
}

async function viewAllStaff() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/api/staff`);
        const staffDatabase = await response.json();

        if (!Array.isArray(staffDatabase)) {
            const message = staffDatabase && staffDatabase.message ? staffDatabase.message : 'Failed to load staff list';
            alert(message);
            staffDirectory = [];
            renderStaffTableRows([]);
            return;
        }

        staffDirectory = staffDatabase.slice();
        const searchInput = document.getElementById('staffSearchInput');
        const searchText = searchInput ? searchInput.value : '';
        renderStaffTableRows(filterStaffRecords(searchText));
    } catch (error) {
        console.error('View staff error:', error);
        alert(`View staff failed: ${error.message}`);
        staffDirectory = [];
        renderStaffTableRows([]);
    }
}

function searchStaffInView() {
    renderStaffTableRows(filterStaffRecords(document.getElementById('staffSearchInput')?.value || ''));
}

function clearStaffSearch() {
    const input = document.getElementById('staffSearchInput');
    if (input) {
        input.value = '';
    }
    renderStaffTableRows(staffDirectory);
}

function filterCustomerRecords(searchText) {
    const keyword = String(searchText || '').trim().toLowerCase();
    if (!keyword) return customerDirectory.slice();

    return customerDirectory.filter((customer) => {
        const id = String(customer.CUSTOMER_ID || '').toLowerCase();
        const name = String(customer.NAME || '').toLowerCase();
        const email = String(customer.EMAIL || '').toLowerCase();
        const phone = String(customer.PHONE || '').toLowerCase();
        return id.includes(keyword)
            || name.includes(keyword)
            || email.includes(keyword)
            || phone.includes(keyword);
    });
}

function renderCustomerTableRows(customerRecords) {
    const customerListTable = document.getElementById('customerList');
    if (!customerListTable) return;

    const customerListBody = customerListTable.querySelector('tbody');
    if (!customerListBody) return;

    if (!Array.isArray(customerRecords) || customerRecords.length === 0) {
        customerListBody.innerHTML = `
            <tr>
                <td colspan="5">No matching customers found.</td>
            </tr>
        `;
        return;
    }

    customerListBody.innerHTML = customerRecords.map(customer => `
        <tr>
            <td>${customer.CUSTOMER_ID}</td>
            <td>${customer.NAME || '-'}</td>
            <td>${customer.EMAIL || '-'}</td>
            <td>${customer.PHONE || '-'}</td>
            <td>
                <button type="button" class="customer-row-btn update" onclick="openUpdateCustomerFromView(${customer.CUSTOMER_ID})">
                    <i class="fa fa-pen"></i> Update
                </button>
            </td>
        </tr>
    `).join('');
}

function searchCustomersInView() {
    const keyword = document.getElementById('customerSearchInput')?.value || '';
    renderCustomerTableRows(filterCustomerRecords(keyword));
}

function clearCustomerSearch() {
    const input = document.getElementById('customerSearchInput');
    if (input) {
        input.value = '';
    }
    renderCustomerTableRows(customerDirectory);
}

async function openUpdateCustomerFromView(customerId) {
    showModalContent('updateCustomer');
    const liveContainer = document.getElementById('customerModalContent');
    if (!liveContainer) return;
    const updateInput = liveContainer.querySelector('#updateCustomerId');
    if (!updateInput) {
        return;
    }
    updateInput.value = String(customerId);
    await fetchAndShowCustomer('update');
}



async function addCustomer() {
    try {
        const liveContainer = document.getElementById('customerModalContent');
        if (!liveContainer) return;
        const customerName = liveContainer.querySelector('#customerName').value;
        const customerEmail = liveContainer.querySelector('#customerEmail').value;
        const customerPhone = liveContainer.querySelector('#customerPhone').value;

        const response = await apiFetch(`${API_BASE_URL}/api/customers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ customerName, customerEmail, customerPhone }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
            console.log('Added customer:', { customerName, customerEmail, customerPhone });
            const liveForm = liveContainer.querySelector('#addCustomerForm');
            if (liveForm) liveForm.reset();
            alert(`Customer added and verified in DB. ID: ${result.customerId}`);
            showCustomerButtons();
        } else {
            alert(result.message || 'Failed to add customer');
            console.error('Failed to add customer', result);
        }
    } catch (error) {
        console.error('Add customer error:', error);
        alert(`Add customer failed: ${error.message}`);
    }
}

async function fetchAndShowCustomer(action) {
    try {
        const liveContainer = document.getElementById('customerModalContent');
        if (!liveContainer) return;
        const customerIdRaw = liveContainer.querySelector('#' + action + 'CustomerId').value;
        const customerId = normalizeNumericIdInput(customerIdRaw);
        if (!customerId) {
            alert('Invalid Customer ID. Please use numeric format.');
            return;
        }

        const response = await apiFetch(`${API_BASE_URL}/api/customers/${customerId}`);
        if (!response.ok) {
            const errorData = await response.json();
            alert(errorData.message || 'Customer not found');
            return;
        }
        const customer = await response.json();

        if (customer) {
            const detailsDiv = liveContainer.querySelector('#' + action + 'CustomerDetails');
            detailsDiv.innerHTML = `
                <label for="${action}CustomerName">Customer Name:</label>
                <input type="text" id="${action}CustomerName" name="${action}CustomerName" value="${customer.NAME}" required><br>
                <label for="${action}CustomerEmail">Customer Email:</label>
                <input type="email" id="${action}CustomerEmail" name="${action}CustomerEmail" value="${customer.EMAIL}" required><br>
                <label for="${action}CustomerPhone">Customer Phone:</label>
                <input type="text" id="${action}CustomerPhone" name="${action}CustomerPhone" value="${customer.PHONE}" required><br>
            `;
        } else {
            alert('Customer not found');
        }
    } catch (error) {
        console.error('Fetch customer error:', error);
        alert(`Fetch customer failed: ${error.message}`);
    }
}

async function updateCustomer() {
    try {
        const liveContainer = document.getElementById('customerModalContent');
        if (!liveContainer) return;
        const customerIdRaw = liveContainer.querySelector('#updateCustomerId').value;
        const customerId = normalizeNumericIdInput(customerIdRaw);
        const customerName = liveContainer.querySelector('#updateCustomerName').value;
        const customerEmail = liveContainer.querySelector('#updateCustomerEmail').value;
        const customerPhone = liveContainer.querySelector('#updateCustomerPhone').value;

        if (!customerId) {
            alert('Invalid Customer ID. Please use numeric format.');
            return;
        }

        const response = await apiFetch(`${API_BASE_URL}/api/customers/${customerId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: customerName, email: customerEmail, phone: customerPhone }),
        });

        const result = await response.json();
        if (response.ok && result.success) {
            console.log('Updated customer:', { customerId, customerName, customerEmail, customerPhone });
            const liveForm = liveContainer.querySelector('#updateCustomerForm');
            if (liveForm) liveForm.reset();
            liveContainer.querySelector('#updateCustomerDetails').innerHTML = '';
            alert(`Customer updated and verified in DB: ${result.customer.CUSTOMER_ID}`);
            showCustomerButtons();
        } else {
            alert(result.message || 'Failed to update customer');
            console.error('Failed to update customer', result);
        }
    } catch (error) {
        console.error('Update customer error:', error);
        alert(`Update customer failed: ${error.message}`);
    }
}

async function deleteCustomer() {
    try {
        const liveContainer = document.getElementById('customerModalContent');
        if (!liveContainer) return;
        const customerIdRaw = liveContainer.querySelector('#deleteCustomerId').value;
        const customerId = normalizeNumericIdInput(customerIdRaw);
        if (!customerId) {
            alert('Invalid Customer ID. Please use numeric format.');
            return;
        }

        const confirmed = confirm(`Delete customer ${customerId}?\nThis will also delete that customer's orders from the system.`);
        if (!confirmed) {
            return;
        }

        const response = await apiFetch(`${API_BASE_URL}/api/customers/${customerId}`, {
            method: 'DELETE',
        });
        const result = await response.json();
        if (response.ok && result.success) {
            console.log('Deleted customer with ID:', customerId);
            const liveForm = liveContainer.querySelector('#deleteCustomerForm');
            if (liveForm) liveForm.reset();
            const deletedOrders = Number(result.deletedOrders || 0);
            alert(`Customer deleted in DB: ${customerId}\nRelated orders removed: ${deletedOrders}`);
            showCustomerButtons();
        } else {
            alert(result.message || 'Failed to delete customer');
            console.error('Failed to delete customer', result);
        }
    } catch (error) {
        console.error('Delete customer error:', error);
        alert(`Delete customer failed: ${error.message}`);
    }
}

async function viewAllCustomers() {
    try {
        const response = await apiFetch(`${API_BASE_URL}/api/customers`);
        const customerDatabase = await response.json();
        if (!Array.isArray(customerDatabase)) {
            alert(customerDatabase && customerDatabase.message ? customerDatabase.message : 'Failed to load customer list');
            customerDirectory = [];
            renderCustomerTableRows([]);
            return;
        }

        customerDirectory = customerDatabase.slice();
        const searchText = document.getElementById('customerSearchInput')?.value || '';
        renderCustomerTableRows(filterCustomerRecords(searchText));
    } catch (error) {
        console.error('View customers error:', error);
        alert(`View customers failed: ${error.message}`);
        customerDirectory = [];
        renderCustomerTableRows([]);
    }
}

//------------------------item------------------------------

const items = [
    // Burgers
    {
      itemCode: "B1001",
      category: "Burgers",
      itemName: "Classic Burger (Large)",
      price: 3000000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-1.png"
    },
    {
      itemCode: "B1002",
      category: "Burgers",
      itemName: "Classic Burger (Regular)",
      price: 6000000.0,
      discount: 15,
      image: "./asset/img/items/burgers/burger-2.png"
    },
    {
      itemCode: "B1003",
      category: "Burgers",
      itemName: "Turkey Burger",
      price: 6400000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-3.png"
    },
    {
      itemCode: "B1004",
      category: "Burgers",
      itemName: "Chicken Burger (Large)",
      price: 5600000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-4.png"
    },
    {
      itemCode: "B1005",
      category: "Burgers",
      itemName: "Chicken Burger (Regular)",
      price: 3200000.0,
      discount: 20,
      image: "./asset/img/items/burgers/burger-5.png"
    },
    {
      itemCode: "B1006",
      category: "Burgers",
      itemName: "Cheese Burger (Large)",
      price: 4000000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-6.png"
    },
    {
      itemCode: "B1007",
      category: "Burgers",
      itemName: "Cheese Burger (Regular)",
      price: 2400000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-7.png"
    },
    {
      itemCode: "B1008",
      category: "Burgers",
      itemName: "Bacon Burger",
      price: 2600000.0,
      discount: 15,
      image: "./asset/img/items/burgers/burger-8.png"
    },
    {
      itemCode: "B1009",
      category: "Burgers",
      itemName: "Shawarma Burger",
      price: 3200000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-9.png"
    },
    {
      itemCode: "B1010",
      category: "Burgers",
      itemName: "Olive Burger",
      price: 7200000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-10.png"
    },
    {
      itemCode: "B1012",
      category: "Burgers",
      itemName: "Double-Cheese Burger",
      price: 5000000.0,
      discount: 20,
      image: "./asset/img/items/burgers/burger-11.png"
    },
    {
      itemCode: "B1013",
      category: "Burgers",
      itemName: "Crispy Chicken Burger (Regular)",
      price: 4800000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-8.png"
    },
    {
      itemCode: "B1014",
      category: "Burgers",
      itemName: "Crispy Chicken Burger (Large)",
      price: 6400000.0,
      discount: 10,
      image: "./asset/img/items/burgers/burger-6.png"
    },
    {
      itemCode: "B1015",
      category: "Burgers",
      itemName: "Paneer Burger",
      price: 3600000.0,
      discount: 0,
      image: "./asset/img/items/burgers/burger-5.png"
    },
  
    // Submarines
    {
      itemCode: "B1016",
      category: "Submarines",
      itemName: "Crispy Chicken Submarine (Large)",
      price: 8000000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-1.jpg"
    },
    {
      itemCode: "B1017",
      category: "Submarines",
      itemName: "Crispy Chicken Submarine (Regular)",
      price: 6000000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-2.jpg"
    },
    {
      itemCode: "B1018",
      category: "Submarines",
      itemName: "Chicken Submarine (Large)",
      price: 7200000.0,
      discount: 3,
      image: "./asset/img/items/submarines/submarine-3.jpg"
    },
    {
      itemCode: "B1019",
      category: "Submarines",
      itemName: "Chicken Submarine (Regular)",
      price: 5600000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-4.jpg"
    },
    {
      itemCode: "B1020",
      category: "Submarines",
      itemName: "Grinder Submarine",
      price: 9200000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-5.jpg"
    },
    {
      itemCode: "B1021",
      category: "Submarines",
      itemName: "Cheese Submarine",
      price: 8800000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-6.jpg"
    },
    {
      itemCode: "B1022",
      category: "Submarines",
      itemName: "Double Cheese n Chicken Submarine",
      price: 7600000.0,
      discount: 16,
      image: "./asset/img/items/submarines/submarine-7.jpg"
    },
    {
      itemCode: "B1023",
      category: "Submarines",
      itemName: "Special Horgie Submarine",
      price: 11200000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-8.jpg"
    },
    {
      itemCode: "B1024",
      category: "Submarines",
      itemName: "MOS Special Submarine",
      price: 12000000.0,
      discount: 0,
      image: "./asset/img/items/submarines/submarine-9.jpg"
    },
  
    // Fries
    {
      itemCode: "B1025",
      category: "Fries",
      itemName: "Steak Fries (Large)",
      price: 4800000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-1.jpg"
    },
    {
      itemCode: "B1026",
      category: "Fries",
      itemName: "Steak Fries (Medium)",
      price: 2400000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-1.jpg"
    },
    {
      itemCode: "B1027",
      category: "Fries",
      itemName: "French Fries (Large)",
      price: 3200000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-2.jpg"
    },
    {
      itemCode: "B1028",
      category: "Fries",
      itemName: "French Fries (Medium)",
      price: 2600000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-2.jpg"
    },
    {
      itemCode: "B1029",
      category: "Fries",
      itemName: "French Fries (Small)",
      price: 1800000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-3.jpg"
    },
    {
      itemCode: "B1030",
      category: "Fries",
      itemName: "Sweet Potato Fries (Large)",
      price: 2400000.0,
      discount: 0,
      image: "./asset/img/items/fries/fries-3.jpg"
    },
  
    // Pasta
    {
      itemCode: "B1031",
      category: "Pasta",
      itemName: "Chicken n Cheese Pasta",
      price: 6400000.0,
      discount: 15,
      image: "./asset/img/items/pasta/pasta-1.jpg"
    },
    {
      itemCode: "B1032",
      category: "Pasta",
      itemName: "Chicken Penne Pasta",
      price: 6800000.0,
      discount: 0,
      image: "./asset/img/items/pasta/pasta-2.jpg"
    },
    {
      itemCode: "B1033",
      category: "Pasta",
      itemName: "Ground Turkey Pasta Bake",
      price: 11600000.0,
      discount: 10,
      image: "./asset/img/items/pasta/pasta-3.jpg"
    },
    {
      itemCode: "B1034",
      category: "Pasta",
      itemName: "Creamy Shrimp Pasta",
      price: 8000000.0,
      discount: 0,
      image: "./asset/img/items/pasta/pasta-4.jpg"
    },
    {
      itemCode: "B1035",
      category: "Pasta",
      itemName: "Lemon Butter Pasta",
      price: 7800000.0,
      discount: 0,
      image: "./asset/img/items/pasta/pasta-5.jpg"
    },
    {
      itemCode: "B1036",
      category: "Pasta",
      itemName: "Tagliatelle Pasta",
      price: 9600000.0,
      discount: 1,
      image: "./asset/img/items/pasta/pasta-6.jpg"
    },
    {
      itemCode: "B1037",
      category: "Pasta",
      itemName: "Baked Ravioli",
      price: 8000000.0,
      discount: 1,
      image: "./asset/img/items/pasta/pasta-7.jpg"
    },
  
    // Chicken
    {
      itemCode: "B1038",
      category: "Chicken",
      itemName: "Fried Chicken (Small)",
      price: 4800000.0,
      discount: 0,
      image: "./asset/img/items/chicken/chicken-1.jpg"
    },
    {
      itemCode: "B1039",
      category: "Chicken",
      itemName: "Fried Chicken (Regular)",
      price: 9200000.0,
      discount: 10,
      image: "./asset/img/items/chicken/chicken-2.jpg"
    },
    {
      itemCode: "B1040",
      category: "Chicken",
      itemName: "Fried Chicken (Large)",
      price: 12400000.0,
      discount: 5,
      image: "./asset/img/items/chicken/chicken-3.jpg"
    },
    {
      itemCode: "B1041",
      category: "Chicken",
      itemName: "Hot Wings (Large)",
      price: 9600000.0,
      discount: 0,
      image: "./asset/img/items/chicken/chicken-4.jpg"
    },
    {
      itemCode: "B1042",
      category: "Chicken",
      itemName: "Devilled Chicken (Large)",
      price: 3600000.0,
      discount: 0,
      image: "./asset/img/items/chicken/chicken-5.jpg"
    },
    {
      itemCode: "B1043",
      category: "Chicken",
      itemName: "BBQ Chicken (Regular)",
      price: 8400000.0,
      discount: 0,
      image: "./asset/img/items/chicken/chicken-6.jpg"
    },
  
    // Beverages
    {
      itemCode: "B1044",
      category: "Beverages",
      itemName: "Pepsi (330ml)",
      price: 3960000.0,
      discount: 5,
      expiryDate: "2024-12-31",
      image: "./asset/img/items/beverages/beverage-1.jpg"
    },
    {
      itemCode: "B1045",
      category: "Beverages",
      itemName: "Coca-Cola (330ml)",
      price: 4920000.0,
      discount: 0,
      image: "./asset/img/items/beverages/beverage-2.jpg",
      expiryDate: "2024-12-31"
    },
    {
      itemCode: "B1046",
      category: "Beverages",
      itemName: "Sprite (330ml)",
      price: 6000000.0,
      discount: 3,
      expiryDate: "2024-07-05",
      image: "./asset/img/items/beverages/beverage-3.jpg"
    },
    {
      itemCode: "B1047",
      category: "Beverages",
      itemName: "Mirinda (330ml)",
      price: 3400000.0,
      discount: 7,
      expiryDate: "2024-12-31",
      image: "./asset/img/items/beverages/beverage-4.jpg"
    },
  ];


  
  const itemContainer = document.getElementById('item-container');
  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const addDialog = document.getElementById('add-dialog');
  const addForm = document.getElementById('add-form');
  
  function formatExpiryDateForInput(value) {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
          return String(value);
      }
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  }

  function syncCategories(uniqueCategories) {
      const addSelect = document.getElementById('add-item-category');
      const editSelect = document.getElementById('edit-item-category');

      uniqueCategories.forEach(category => {
          [addSelect, editSelect].forEach(select => {
              if (select) {
                  let exists = false;
                  for (let i = 0; i < select.options.length; i++) {
                      if (select.options[i].value.toLowerCase() === category.toLowerCase()) {
                          exists = true;
                          break;
                      }
                  }
                  if (!exists) {
                      const option = document.createElement('option');
                      option.value = category;
                      option.textContent = category;
                      select.appendChild(option);
                  }
              }
          });

          const filterContainers = document.querySelectorAll('.filter-buttons');
          filterContainers.forEach(container => {
              const existingBtn = Array.from(container.querySelectorAll('.filter-btn')).find(b => b.getAttribute('data-category').toLowerCase() === category.toLowerCase());
              if (!existingBtn) {
                  const btn = document.createElement('button');
                  btn.className = 'filter-btn';
                  btn.setAttribute('data-category', category);
                  btn.textContent = category;
                  
                  btn.addEventListener('click', function(e) {
                      const cat = e.target.getAttribute('data-category');
                      if (container.closest('#home')) {
                          if (window.refreshHomeItemsView) window.refreshHomeItemsView(cat);
                      } else if (container.closest('#items')) {
                          if (typeof displayItems === 'function') displayItems(cat);
                      }
                      container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                      e.target.classList.add('active');
                  });
                  container.appendChild(btn);
              }
          });
      });
  }

  function mapStockItemFromApi(row) {
      return {
          itemCode: row.ITEM_CODE,
          category: row.CATEGORY,
          itemName: row.ITEM_NAME,
          price: Number(row.PRICE || 0),
          discount: Number(row.DISCOUNT || 0),
          image: row.IMAGE,
          expiryDate: formatExpiryDateForInput(row.EXPIRY_DATE),
          quantity: Number(row.QUANTITY || 0)
      };
  }

  async function syncStockFromDatabase(showError = false) {
      try {
          const response = await apiFetch(`${API_BASE_URL}/api/items`);
          const payload = await response.json();
          if (!response.ok || !Array.isArray(payload)) {
              throw new Error((payload && payload.message) || 'Failed to load stock from database.');
          }

          items.splice(0, items.length, ...payload.map(mapStockItemFromApi));
          
          const uniqueCategories = [...new Set(items.map(item => item.category))].filter(Boolean);
          syncCategories(uniqueCategories);
          return true;
      } catch (error) {
          console.error('Stock sync error:', error);
          if (showError) {
              alert(`Failed to sync stock: ${error.message}`);
          }
          return false;
      }
  }

  function getActiveStockCategory() {
      const active = document.querySelector('#items .filter-btn.active');
      return active ? active.getAttribute('data-category') : 'ALL';
  }

  function refreshStockViews() {
      displayItems(getActiveStockCategory());
      if (typeof window.refreshHomeItemsView === 'function') {
          window.refreshHomeItemsView();
      }
  }
  
  document.addEventListener('DOMContentLoaded', async () => {
      setupEventListeners();
      await syncStockFromDatabase(false);
      refreshStockViews();
  });
  
  function displayItems(category) {
      if (!itemContainer) return;
      itemContainer.innerHTML = '';
      const filteredItems = category === 'ALL' ? items : items.filter(item => item.category === category);
  
      filteredItems.forEach(item => {
          const itemBox = document.createElement('div');
          itemBox.classList.add('item-box');
  
          const currentDate = new Date();
          const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;
          const isExpired = expiryDate && expiryDate < currentDate;
  
          const itemDetails = `
              <img src="${item.image}" alt="${item.itemName}">
              <h3>${item.itemName}</h3>
              <p>Price: KHR. ${item.price.toFixed(2)}</p>
              ${item.discount > 0 ? `<p>Discount: ${item.discount.toFixed(2)}%</p>` : ''}
              <p>Stock In: <span style="font-weight:bold; color: #2563eb;">${item.quantity}</span></p>
              ${isExpired ? `<p class="expired-warning">This item has expired!</p>` : ''}
              <button class="edit-btn" data-id="${item.itemCode}">Edit</button>
              <button class="delete-btn" data-id="${item.itemCode}">Delete</button>
          `;
  
          itemBox.innerHTML = itemDetails;
          itemContainer.appendChild(itemBox);
      });
  }
  
  function setupEventListeners() {
      setupImageUploadControls();

      document.querySelectorAll('#items .filter-btn').forEach(button => {
          button.addEventListener('click', (e) => {
              const category = e.target.getAttribute('data-category');
              displayItems(category);
              document.querySelectorAll('#items .filter-btn').forEach(btn => btn.classList.remove('active'));
              e.target.classList.add('active');
          });
      });
  
      itemContainer.addEventListener('click', (e) => {
          if (e.target.classList.contains('edit-btn')) {
              const itemCode = e.target.getAttribute('data-id');
              openEditDialog(itemCode);
          } else if (e.target.classList.contains('delete-btn')) {
              const itemCode = e.target.getAttribute('data-id');
              deleteItem(itemCode).catch((error) => {
                  console.error(error);
                  alert(`Failed to delete stock: ${error.message}`);
              });
          }
      });
  
      document.getElementById('add-item-btn').addEventListener('click', () => {
        document.getElementById('add-dialog').style.display = 'flex';
        setItemImagePreview('add-item-image-preview', document.getElementById('add-item-image').value);
    });
    
    document.getElementById('close-add-dialog').addEventListener('click', () => {
        document.getElementById('add-dialog').style.display = 'none';
    });
    
    document.getElementById('add-form').addEventListener('submit', async (e) => {
        e.preventDefault();
  
      
        const newItem = {
            itemCode: document.getElementById('add-item-code').value.trim().toUpperCase(),
            itemName: document.getElementById('add-item-name').value,
            price: parseFloat(document.getElementById('add-item-price').value),
            discount: parseFloat(document.getElementById('add-item-discount').value) || 0,
            quantity: parseInt(document.getElementById('add-item-quantity').value, 10) || 0,
            image: document.getElementById('add-item-image').value,
            category: document.getElementById('add-item-category').value,
            expiryDate: document.getElementById('add-item-expiry').value || null
        };

        try {
            await addItem(newItem);
            addDialog.style.display = 'none';
            document.getElementById('add-form').reset();
            document.getElementById('add-item-image-file').value = '';
            setItemImagePreview('add-item-image-preview', '');
            alert('Stock item created and saved to database.');
        } catch (error) {
            console.error(error);
            alert(`Failed to create stock: ${error.message}`);
        }
      });
  
      document.querySelector('.close-btn').addEventListener('click', () => {
          editDialog.style.display = 'none';
      });
  
      editForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const itemCode = document.getElementById('edit-item-id').value.trim().toUpperCase();
          const existingItem = items.find(item => item.itemCode === itemCode);
          if (!existingItem) {
              alert('Unable to find the selected stock item.');
              return;
          }
          const updatedItem = {
              itemCode: document.getElementById('edit-item-code').value.trim().toUpperCase(),
            category: document.getElementById('edit-item-category').value,
              itemName: document.getElementById('edit-item-name').value,
              price: parseFloat(document.getElementById('edit-item-price').value),
              discount: parseFloat(document.getElementById('edit-item-discount').value),
              quantity: parseInt(document.getElementById('edit-item-quantity').value, 10) || 0,
              image: document.getElementById('edit-item-image').value,
              expiryDate: document.getElementById('edit-item-expiry').value || null
          };
          try {
              await updateItem(itemCode, updatedItem);
              editDialog.style.display = 'none';
              alert('Stock item updated in database.');
          } catch (error) {
              console.error(error);
              alert(`Failed to update stock: ${error.message}`);
          }
      });
  }

  function setupImageUploadControls() {
      bindUploadControl('add-item-image-upload-btn', 'add-item-image-file', 'add-item-image', 'add-item-image-preview');
      bindUploadControl('edit-item-image-upload-btn', 'edit-item-image-file', 'edit-item-image', 'edit-item-image-preview');
  }

  function bindUploadControl(buttonId, fileInputId, urlInputId, previewId) {
      const uploadBtn = document.getElementById(buttonId);
      const fileInput = document.getElementById(fileInputId);
      const urlInput = document.getElementById(urlInputId);

      if (!uploadBtn || !fileInput || !urlInput) return;

      uploadBtn.addEventListener('click', () => {
          fileInput.click();
      });

      fileInput.addEventListener('change', () => {
          const selectedFile = fileInput.files && fileInput.files[0];
          if (!selectedFile) return;

          const reader = new FileReader();
          reader.onload = () => {
              const dataUrl = reader.result;
              urlInput.value = dataUrl;
              setItemImagePreview(previewId, dataUrl);
          };
          reader.readAsDataURL(selectedFile);
      });

      urlInput.addEventListener('input', () => {
          setItemImagePreview(previewId, urlInput.value);
      });
  }
  
  window.addNewCategory = function(selectId) {
      const select = document.getElementById(selectId);
      if (!select) return;

      const newCategory = prompt('Enter new category name:');
      if (newCategory && newCategory.trim()) {
          const value = newCategory.trim();
          syncCategories([value]);
          for (let i = 0; i < select.options.length; i++) {
              if (select.options[i].value.toLowerCase() === value.toLowerCase()) {
                  select.selectedIndex = i;
                  break;
              }
          }
      }
  };
  
  function openEditDialog(itemCode) {
      const item = items.find(item => item.itemCode === itemCode);
      if (item) {
          document.getElementById('edit-item-id').value = item.itemCode;
          document.getElementById('edit-item-code').value = item.itemCode;
        document.getElementById('edit-item-category').value = item.category || 'Burgers';
          document.getElementById('edit-item-name').value = item.itemName;
          document.getElementById('edit-item-price').value = item.price;
          document.getElementById('edit-item-discount').value = item.discount;
          document.getElementById('edit-item-quantity').value = item.quantity;
          document.getElementById('edit-item-image').value = item.image;
          document.getElementById('edit-item-expiry').value = item.expiryDate || '';
          document.getElementById('edit-item-image-file').value = '';
          setItemImagePreview('edit-item-image-preview', item.image);
          editDialog.style.display = 'flex';
      } else {
          console.error(`Item with itemCode: ${itemCode} not found`);
      }
  }
  
  function updateItem(itemCode, updatedItem) {
      return updateStockInDatabase(itemCode, updatedItem).then(async () => {
          await syncStockFromDatabase(false);
          refreshStockViews();
      });
  }
  
  function deleteItem(itemCode) {
      return deleteStockFromDatabase(itemCode).then(async () => {
          await syncStockFromDatabase(false);
          refreshStockViews();
      });
  }
  
  function addItem(newItem) {
      return createStockInDatabase(newItem).then(async () => {
          await syncStockFromDatabase(false);
          refreshStockViews();
      });
  }

  async function createStockInDatabase(item) {
      const response = await apiFetch(`${API_BASE_URL}/api/items`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(item)
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
          throw new Error((payload && payload.message) || 'Failed to create stock item.');
      }
      return payload.item;
  }

  async function updateStockInDatabase(originalItemCode, item) {
      const response = await apiFetch(`${API_BASE_URL}/api/items/${encodeURIComponent(originalItemCode)}`, {
          method: 'PUT',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify(item)
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
          throw new Error((payload && payload.message) || 'Failed to update stock item.');
      }
      return payload.item;
  }

  async function deleteStockFromDatabase(itemCode) {
      const response = await apiFetch(`${API_BASE_URL}/api/items/${encodeURIComponent(itemCode)}`, {
          method: 'DELETE'
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
          throw new Error((payload && payload.message) || 'Failed to delete stock item.');
      }
      return payload;
  }










document.addEventListener('DOMContentLoaded', async function() {
    const cart = [];
    const orders = [];
    let customerDatabase = [];
    let homeActiveCategory = 'ALL';

    function printInvoiceFromOrder(order) {
        if (!order) {
            alert('Order not found.');
            return;
        }

        if (!window.jspdf || !window.jspdf.jsPDF) {
            alert('PDF library is not loaded yet.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 14;
        const textFontSize = 10;
        const orderDateObj = order.timestamp ? new Date(order.timestamp) : new Date();
        const orderDate = orderDateObj.toLocaleDateString();
        const orderTime = orderDateObj.toLocaleTimeString();

        // Header band
        doc.setFillColor(26, 32, 44);
        doc.rect(0, 0, pageWidth, 34, 'F');
        doc.setFillColor(237, 137, 54);
        doc.rect(0, 34, pageWidth, 3, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(19);
        doc.text('HAK Burger', margin, 16);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('Fresh taste, fast service, happy customers.', margin, 23);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('INVOICE', pageWidth - margin, 18, { align: 'right' });

        // Logo block (optional)
        try {
            const logoUrl = './asset/img/logo.png';
            doc.addImage(logoUrl, 'PNG', pageWidth - 44, 4, 28, 28);
        } catch (_logoError) {
            // Continue without logo.
        }

        // Customer/order info card
        const infoTop = 44;
        doc.setDrawColor(210, 214, 220);
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(margin, infoTop, pageWidth - margin * 2, 36, 2, 2, 'FD');
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(textFontSize);
        doc.text(`Order ID: ${order.orderId ?? 'N/A'}`, margin + 4, infoTop + 9);
        doc.text(`Date: ${orderDate}`, margin + 4, infoTop + 16);
        doc.text(`Time: ${orderTime}`, margin + 4, infoTop + 23);
        doc.text(`Customer: ${order.customerName || 'Unknown'} (${order.customerCode || 'N/A'})`, margin + 4, infoTop + 30);

        const columns = [
            { header: 'Item', dataKey: 'name' },
            { header: 'Price', dataKey: 'price' },
            { header: 'Quantity', dataKey: 'quantity' },
            { header: 'Total', dataKey: 'total' }
        ];

        const tableData = (order.items || []).map((item) => ({
            name: item.name || item.itemCode || 'N/A',
            price: `riel ${Number(item.price || 0).toFixed(2)}`,
            quantity: String(item.quantity || 0),
            total: `riel ${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}`
        }));

        let finalY = infoTop + 43;
        if (typeof doc.autoTable === 'function') {
            try {
                doc.autoTable(columns, tableData, {
                    startY: finalY,
                    margin: { horizontal: margin },
                    styles: { fontSize: textFontSize, textColor: [31, 41, 55] },
                    headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
                    alternateRowStyles: { fillColor: [247, 250, 252] },
                    bodyStyles: { fillColor: [255, 255, 255] },
                    theme: 'striped',
                    tableLineColor: [226, 232, 240],
                    tableLineWidth: 0.1
                });
                finalY = doc.lastAutoTable.finalY;
            } catch (_tableError) {
                tableData.forEach((row, index) => {
                    const y = finalY + index * 7;
                    doc.text(`${row.name} | ${row.price} | ${row.quantity} | ${row.total}`, margin, y);
                });
                finalY += tableData.length * 7;
            }
        } else {
            // Fallback if autotable is unavailable.
            tableData.forEach((row, index) => {
                const y = finalY + index * 7;
                doc.text(`${row.name} | ${row.price} | ${row.quantity} | ${row.total}`, margin, y);
            });
            finalY += tableData.length * 7;
        }

        // Summary block
        let summaryTop = finalY + 8;
        if (summaryTop > 238) {
            doc.addPage();
            summaryTop = 20;
        }
        const summaryWidth = pageWidth - margin * 2;
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(margin, summaryTop, summaryWidth, 32, 2, 2, 'FD');
        doc.setTextColor(31, 41, 55);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('Payment Summary', margin + 4, summaryTop + 8);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(textFontSize);
        doc.text(`Total: riel ${Number(order.totalPrice || 0).toFixed(2)}`, margin + 4, summaryTop + 16);
        doc.text(`Discount: riel ${Number(order.discountPrice || 0).toFixed(2)}`, margin + 4, summaryTop + 23);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(22, 163, 74);
        doc.text(`Final Total: riel ${Number(order.finalTotalPrice || 0).toFixed(2)}`, margin + 4, summaryTop + 30);

        // Customer service footer
        const footerY = summaryTop + 42;
        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(9);
        doc.text('Thank you for choosing HAK Burger. We are happy to serve you.', margin, footerY);
        doc.text('For support, please provide Order ID to our customer service team.', margin, footerY + 6);

        // Print through system dialog instead of downloading.
        doc.autoPrint();
        const blobUrl = doc.output('bloburl');
        const printWindow = window.open(blobUrl, '_blank');
        if (!printWindow) {
            alert('Unable to open print window. Please allow popups.');
            return;
        }
        setTimeout(() => {
            try {
                printWindow.focus();
                printWindow.print();
            } catch (_printError) {
                // Ignore; some PDF viewers handle autoPrint internally.
            }
        }, 700);
    }

    async function populateCustomerDropdown() {
        const response = await apiFetch(`${API_BASE_URL}/api/customers`);
        customerDatabase = await response.json();
        const customerSelect = document.getElementById('customer-select');
        customerSelect.innerHTML = ''; 
        customerDatabase.forEach(customer => {
            const option = document.createElement('option');
            option.value = customer.CUSTOMER_ID;
            option.textContent = customer.NAME;
            customerSelect.appendChild(option);
        });
    }

    function displayHomeItems(category = 'ALL') {
        homeActiveCategory = category;
        const itemContainer = document.getElementById('home-item-container');
        itemContainer.innerHTML = '';

        let filteredItems = category === 'ALL' ? items : items.filter(item => item.category === category);
        filteredItems = filteredItems.filter(item => item.quantity > 0);
        const currentDate = new Date();

        filteredItems.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'item';

            
            const expiryDate = item.expiryDate ? new Date(item.expiryDate) : null;
            const isExpired = expiryDate && expiryDate < currentDate;

            itemElement.innerHTML = `
                <img src="${item.image}" alt="${item.itemName}">
                <h4>${item.itemName}</h4>
                <p>Price: riel ${item.price.toFixed(2)}</p>
                ${item.discount > 0 ? `<p>Discount: ${item.discount.toFixed(2)}%</p>` : ''}
                <p>Stock In: <span style="font-weight:bold; color: #2563eb;">${item.quantity}</span></p>
                <button onclick="addToCart('${item.itemCode}')" >Add to Cart</button>
                ${isExpired ? `<p class="expired-warning">This item has expired!</p>` : ''}
            `;
            itemContainer.appendChild(itemElement);
        });
    }

    window.refreshHomeItemsView = function(category) {
        if (category) homeActiveCategory = category;
        displayHomeItems(homeActiveCategory);
    };

    function displayCart() {
        const cartItems = document.getElementById('cart-items');
        const totalPriceElem = document.getElementById('total-price');
        const discountPriceElem = document.getElementById('discount-price');
        const finalTotalPriceElem = document.getElementById('final-total-price');

        cartItems.innerHTML = '';
        let totalPrice = 0;
        let totalDiscount = 0;

        cart.forEach(cartItem => {
            const item = items.find(i => i.itemCode === cartItem.id);
            if (!item) return;

            const discountAmount = (item.discount / 100) * item.price * cartItem.quantity;
            const priceAfterDiscount = item.price * cartItem.quantity - discountAmount;

            const itemElement = document.createElement('li');
            itemElement.className = 'cart-item';
            itemElement.innerHTML = `
                <span class="item-name">${cartItem.name}</span>
                <span class="item-price">${item.price.toFixed(2)}</span>
                <span class="item-quantity">${cartItem.quantity}</span>
                <span class="item-total">${priceAfterDiscount.toFixed(2)}</span>
                <button onclick="removeFromCart('${cartItem.id}')" style="background-color: #dc3545; color: #fff; border: none; border-radius: 5px; padding: 5px 10px; cursor: pointer; font-size: 16px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;">
                <i class="fa fa-remove"></i>
                </button>
            `;
            cartItems.appendChild(itemElement);

            totalPrice += item.price * cartItem.quantity;
            totalDiscount += discountAmount;
        });

        const finalTotalPrice = totalPrice - totalDiscount;

        totalPriceElem.textContent = totalPrice.toFixed(2);
        discountPriceElem.textContent = totalDiscount.toFixed(2);
        finalTotalPriceElem.textContent = finalTotalPrice.toFixed(2);
    }

    let visibleOrders = [];
    let currentOrderFilter = '';

    function applyOrderFilter(searchValue = '') {
        currentOrderFilter = (searchValue || '').trim();
        updateOrdersSection(currentOrderFilter);
    }

    async function loadOrders() {
        const response = await apiFetch(`${API_BASE_URL}/api/orders`);
        const savedOrders = await response.json();
        orders.length = 0;
        savedOrders.forEach(order => orders.push(order));
        applyOrderFilter(currentOrderFilter);
    }

    function formatOrderDateTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString([], {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    window.printOrderInvoiceByIndex = function(index) {
        const order = visibleOrders[index];
        printInvoiceFromOrder(order);
    };

    async function sendOrderDetails() {
        if (cart.length === 0) {
            alert('Cart is empty.');
            return;
        }

        const selectedCustomerId = document.getElementById('customer-select').value;
        const customer = customerDatabase.find(c => String(c.CUSTOMER_ID) === String(selectedCustomerId));

        if (!customer) {
            alert('Please select a customer.');
            return;
        }

        const orderDetails = {
            customerId: customer.CUSTOMER_ID,
            orderDate: new Date().toISOString(), // client computer time
            items: cart.map(cartItem => {
                const item = items.find(i => i.itemCode === cartItem.id);
                return {
                    itemCode: item.itemCode,
                    name: item.itemName,
                    price: item.price,
                    quantity: cartItem.quantity
                };
            }),
            totalPrice: parseFloat(document.getElementById('total-price').textContent),
            discountPrice: parseFloat(document.getElementById('discount-price').textContent),
            finalTotalPrice: parseFloat(document.getElementById('final-total-price').textContent)
        };

        const response = await apiFetch(`${API_BASE_URL}/api/orders`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderDetails)
        });

        if (!response.ok) {
            alert('Failed to save order.');
            return;
        }

        const savedOrder = await response.json();
        orders.unshift(savedOrder);
        applyOrderFilter(currentOrderFilter);
        clearCart();
        await syncStockFromDatabase(false);
        refreshStockViews();
    }

    function updateOrdersSection(searchTerm = '') {
        const orderDetailsContainer = document.getElementById('orders-table').getElementsByTagName('tbody')[0];
        orderDetailsContainer.innerHTML = '';

        let customerTotalDiscount = 0;
        let customerFinalTotalPrice = 0;
        const normalizedSearch = String(searchTerm || '').toLowerCase();
        const filteredOrders = normalizedSearch
            ? orders.filter(order => {
                const customerCode = String(order.customerCode || '').toLowerCase();
                const customerName = String(order.customerName || '').toLowerCase();
                const orderId = String(order.orderId || '').toLowerCase();
                return customerCode.includes(normalizedSearch)
                    || customerName.includes(normalizedSearch)
                    || orderId.includes(normalizedSearch);
            })
            : orders;
        visibleOrders = filteredOrders.slice();

        
        filteredOrders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        filteredOrders.forEach((order, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formatOrderDateTime(order.timestamp)}</td>
                <td>${order.customerCode}</td>
                <td>${order.customerName}</td>
                <td>${order.items.map(item => item.name).join(', ')}</td>
                <td>${order.items.reduce((acc, item) => acc + item.quantity, 0)}</td>
                <td>${order.items.reduce((acc, item) => acc + item.price * item.quantity, 0).toFixed(2)}</td>
                <td>${order.finalTotalPrice.toFixed(2)}</td>
                <td><button type="button" onclick="printOrderInvoiceByIndex(${index})">Printe Invoice</button></td>
            `;
            orderDetailsContainer.appendChild(row);

            customerTotalDiscount += order.discountPrice;
            customerFinalTotalPrice += order.finalTotalPrice;
        });

        
        const totalSummary = document.querySelector('.total-summary');
        totalSummary.innerHTML = `
            <b><p class="discount-price">Discount Price: riel ${customerTotalDiscount.toFixed(2)}</p></b>
            <b><p class="final-total-price">Final Total: riel ${customerFinalTotalPrice.toFixed(2)}</p></b>
        `;

        
    }

    function clearCart() {
        cart.length = 0;
        displayCart();
    }

    function clearSearch() {
        document.getElementById('search-bar').value = '';
        applyOrderFilter('');
    }

    function searchOrders() {
        const searchValue = document.getElementById('search-bar').value.trim();
        applyOrderFilter(searchValue);
    }

    window.addToCart = function(itemCode) {
        const item = items.find(i => i.itemCode === itemCode);
        if (item) {
            const cartItem = cart.find(ci => ci.id === itemCode);
            if (item.quantity <= 0) {
                alert(`Sorry, ${item.itemName} is out of stock!`);
                return;
            }
            if (cartItem) {
                if (cartItem.quantity >= item.quantity) {
                    alert(`Cannot add more ${item.itemName}. Only ${item.quantity} in stock.`);
                    return;
                }
                cartItem.quantity += 1;
            } else {
                cart.push({ 
                    id: item.itemCode, 
                    name: item.itemName, 
                    price: item.price, 
                    quantity: 1 
                });
            }
            displayCart();
        }
    };

    window.removeFromCart = function(itemId) {
        const itemIndex = cart.findIndex(ci => ci.id === itemId);
        if (itemIndex > -1) {
            cart.splice(itemIndex, 1);
            displayCart();
        }
    };

    
    const homeFilterButtons = document.querySelectorAll('#home .filter-btn');
    homeFilterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const category = this.getAttribute('data-category');
            displayHomeItems(category);

            
            homeFilterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
        });
    });

    
    document.getElementById('send-order-btn').addEventListener('click', () => {
        sendOrderDetails().catch((error) => {
            console.error(error);
            alert('Failed to save order.');
        });
    });
    document.getElementById('search-btn').addEventListener('click', searchOrders);
    document.getElementById('clear-search-btn').addEventListener('click', clearSearch);
  

    
// Function to hide all report sections
function hideAllReports() {
  document.querySelectorAll('.report-section').forEach(section => {
      section.style.display = 'none';
  });
}

// Function to display a specific report section
function showReportSection(sectionId) {
  hideAllReports();
  const targetSection = document.getElementById(sectionId);
  if (targetSection) {
      targetSection.style.display = 'block';
  }
}

function setReportNote(noteId, text) {
  const note = document.getElementById(noteId);
  if (note) {
      note.textContent = text;
  }
}

function printReportSection(sectionId, title) {
  const section = document.getElementById(sectionId);
  if (!section) {
      alert('Report section not found.');
      return;
  }

  const table = section.querySelector('table');
  const rows = table ? table.querySelectorAll('tbody tr') : [];
  if (!table || rows.length === 0) {
      alert('Please generate this report first.');
      return;
  }

  const noteElem = section.querySelector('.report-note');
  const noteText = noteElem ? noteElem.textContent : '';

  const now = new Date();
  const printWindow = window.open('', '_blank', 'width=1024,height=768');
  if (!printWindow) {
      alert('Unable to open print window. Please allow popups.');
      return;
  }

  const tableHtml = table.outerHTML;
  printWindow.document.open();
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
        body { 
            font-family: 'Poppins', sans-serif; 
            margin: 40px; 
            color: #333; 
            background-color: #f9f9f9;
        }
        .container {
            background: #fff;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.05);
            max-width: 900px;
            margin: 0 auto;
        }
        .header { 
            border-bottom: 3px solid #ff6b6b; 
            padding-bottom: 20px; 
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }
        .shop-info { display: flex; flex-direction: column; }
        .shop-name { 
            font-size: 32px; font-weight: 700; color: #2c3e50; 
            margin: 0; text-transform: uppercase; letter-spacing: 1px;
        }
        .report-title { font-size: 20px; margin-top: 5px; color: #e74c3c; font-weight: 600; }
        .meta-info { text-align: right; }
        .meta { color: #7f8c8d; font-size: 14px; margin-bottom: 4px; }
        .note {
            background-color: #fff4e6;
            border-left: 4px solid #ff9f43;
            padding: 12px 16px;
            margin-bottom: 25px;
            font-size: 15px;
            color: #d35400;
            border-radius: 0 4px 4px 0;
        }
        table { 
            width: 100%; border-collapse: collapse; margin-top: 10px; 
            border-radius: 6px; overflow: hidden; box-shadow: 0 0 10px rgba(0,0,0,0.03);
        }
        th, td { padding: 14px 16px; text-align: left; }
        th { 
            background-color: #34495e; color: #ffffff; font-weight: 600;
            text-transform: uppercase; font-size: 13px; letter-spacing: 0.5px;
        }
        td { border-bottom: 1px solid #ecf0f1; color: #2c3e50; font-size: 14px; }
        tr:nth-child(even) { background-color: #f8f9fa; }
        tr:hover { background-color: #fdf2e9; }
        .footer { 
            margin-top: 40px; font-size: 13px; color: #95a5a6; 
            text-align: center; border-top: 1px solid #ecf0f1; padding-top: 20px;
        }
        @media print {
            body { background: transparent; margin: 0; }
            .container { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
        }
      </style>
    </head>
    <body>
      <div class="container">
          <div class="header">
            <div class="shop-info">
                <h1 class="shop-name">HAK Burger</h1>
                <div class="report-title">${title}</div>
            </div>
            <div class="meta-info">
                <div class="meta"><strong>Date:</strong> ${now.toLocaleDateString()}</div>
                <div class="meta"><strong>Time:</strong> ${now.toLocaleTimeString()}</div>
            </div>
          </div>
          ${noteText ? `<div class="note">${noteText}</div>` : ''}
          ${tableHtml}
          <div class="footer">
            <p>Prepared by HAK Burger Reporting Service &copy; ${now.getFullYear()}</p>
          </div>
      </div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
      printWindow.print();
      printWindow.close();
  }, 300);
}

// Function to generate Monthly Sales Report
function generateMonthlySalesReport() {
  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = new Date().getFullYear();
  let totalMonthlyPrice = 0;
  let totalQuantity = 0;

  const monthlyOrders = orders.filter(order => {
      const orderDate = new Date(order.timestamp);
      return orderDate.getFullYear() === currentYear && orderDate.toLocaleString('default', { month: 'long' }) === currentMonth;
  });

  monthlyOrders.forEach(order => {
      totalMonthlyPrice += order.finalTotalPrice;
      order.items.forEach(item => {
          totalQuantity += item.quantity;
      });
  });

  const tableBody = document.querySelector('#monthly-report-table tbody');
  tableBody.innerHTML = `
      <tr>
          <td>${currentMonth}</td>
          <td>riel ${totalMonthlyPrice.toFixed(2)}</td>
          <td>${totalQuantity}</td>
      </tr>
  `;
  setReportNote('monthly-report-note', `Month: ${currentMonth} ${currentYear} | Total Sales: riel ${totalMonthlyPrice.toFixed(2)} | Qty: ${totalQuantity}`);

  showReportSection('monthly-report');
}

// Function to generate Annual Sales Report
function generateAnnualSalesReport() {
  const currentYear = new Date().getFullYear();
  let totalAnnualPrice = 0;

  const annualOrders = orders.filter(order => {
      const orderDate = new Date(order.timestamp);
      return orderDate.getFullYear() === currentYear;
  });

  annualOrders.forEach(order => {
      totalAnnualPrice += order.finalTotalPrice;
  });

  const tableBody = document.querySelector('#annual-report-table tbody');
  tableBody.innerHTML = `
      <tr>
          <td>${currentYear}</td>
          <td>riel ${totalAnnualPrice.toFixed(2)}</td>
      </tr>
  `;
  setReportNote('annual-report-note', `Year: ${currentYear} | Total Annual Sales: riel ${totalAnnualPrice.toFixed(2)}`);

  showReportSection('annual-report');
}

// Function to view Top Customers
async function viewTopCustomers() {
  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  const currentYear = new Date().getFullYear();

  const monthlyOrders = orders.filter(order => {
      const orderDate = new Date(order.timestamp);
      return orderDate.getFullYear() === currentYear && orderDate.toLocaleString('default', { month: 'long' }) === currentMonth;
  });

  const customerSpending = monthlyOrders.reduce((acc, order) => {
      if (!acc[order.customerCode]) {
          acc[order.customerCode] = 0;
      }
      acc[order.customerCode] += order.finalTotalPrice;
      return acc;
  }, {});

  const response = await apiFetch(`${API_BASE_URL}/api/customers`);
  const customerDatabase = await response.json();
  const customerNames = {};
  customerDatabase.forEach(customer => {
      customerNames[customer.CUSTOMER_ID] = customer.NAME;
  });

  const topCustomers = Object.keys(customerSpending).map(id => ({
      customerId: id,
      customerName: customerNames[id],
      totalSpent: customerSpending[id]
  })).sort((a, b) => b.totalSpent - a.totalSpent);

  const tableBody = document.querySelector('#top-customers-table tbody');
  tableBody.innerHTML = topCustomers.map(customer => `
      <tr>
          <td>${customer.customerId}</td>
          <td>${customer.customerName}</td>
          <td>riel ${customer.totalSpent.toFixed(2)}</td>
      </tr>
  `).join('');
  setReportNote('top-customers-note', `Top ${topCustomers.length} customers ranked by spending for ${currentMonth} ${currentYear}.`);

  showReportSection('top-customers-report');
}

// Function to generate Food Items Count Report
function generateFoodItemsCountReport() {
  const itemCount = orders.reduce((acc, order) => {
      order.items.forEach(item => {
          const itemName = item.name || item.itemCode;
          acc[itemName] = (acc[itemName] || 0) + item.quantity;
      });
      return acc;
  }, {});

  const itemCountArray = Object.keys(itemCount).map(itemName => ({
      name: itemName,
      totalSold: itemCount[itemName]
  }));

  itemCountArray.sort((a, b) => b.totalSold - a.totalSold);

  const tableBody = document.querySelector('#food-items-table tbody');
  tableBody.innerHTML = itemCountArray.map(item => `
      <tr>
          <td>${item.name}</td>
          <td>${item.totalSold}</td>
      </tr>
  `).join('');
  setReportNote('food-items-note', `Top selling items based on current order history. Items counted: ${itemCountArray.length}.`);

  showReportSection('food-items-report');
}

// Function to generate Inventory Status Report
function generateInventoryReport() {
  const itemCount = orders.reduce((acc, order) => {
      order.items.forEach(item => {
          const itemCode = item.itemCode;
          acc[itemCode] = (acc[itemCode] || 0) + item.quantity;
      });
      return acc;
  }, {});

  const tableBody = document.querySelector('#inventory-report-table tbody');
  tableBody.innerHTML = items.map(item => `
      <tr>
          <td>${item.itemCode}</td>
          <td>${item.itemName}</td>
          <td>${item.quantity}</td>
          <td>${itemCount[item.itemCode] || 0}</td>
      </tr>
  `).join('');
  setReportNote('inventory-report-note', `Inventory Status for all items showing Stock In (Current) and Stock Out (Total Sold).`);
  showReportSection('inventory-report');
}

window.printMonthlyReport = function() {
  printReportSection('monthly-report', 'Monthly Sales Report');
};

window.printAnnualReport = function() {
  printReportSection('annual-report', 'Annual Sales Report');
};

window.printTopCustomersReport = function() {
  printReportSection('top-customers-report', 'Top Customers Report');
};

window.printFoodItemsReport = function() {
  printReportSection('food-items-report', 'Food Items Count Report');
};

window.printInventoryReport = function() {
  printReportSection('inventory-report', 'Inventory Status Report');
};

// Event listeners for report buttons (admin page only)
const monthlyReportBtn = document.getElementById('monthly-report-btn');
const annualReportBtn = document.getElementById('annual-report-btn');
const topCustomersBtn = document.getElementById('top-customers-btn');
const foodItemsReportBtn = document.getElementById('food-items-report-btn');
const inventoryReportBtn = document.getElementById('inventory-report-btn');

if (monthlyReportBtn) monthlyReportBtn.addEventListener('click', generateMonthlySalesReport);
if (annualReportBtn) annualReportBtn.addEventListener('click', generateAnnualSalesReport);
if (topCustomersBtn) topCustomersBtn.addEventListener('click', viewTopCustomers);
if (foodItemsReportBtn) foodItemsReportBtn.addEventListener('click', generateFoodItemsCountReport);
if (inventoryReportBtn) inventoryReportBtn.addEventListener('click', generateInventoryReport);




    
    await syncStockFromDatabase(false);
    await populateCustomerDropdown();
    await loadOrders();
    displayHomeItems(homeActiveCategory);
    displayCart();
});














document.addEventListener('DOMContentLoaded', function () {
  const cart = document.querySelector('.cart');
  const toggleButton = document.getElementById('cart-toggle');

  // Toggle cart visibility
  toggleButton.addEventListener('click', function () {
      if (cart.style.display === 'none' || !cart.style.display) {
          cart.style.display = 'flex'; // Show the cart
      } else {
          cart.style.display = 'none'; // Hide the cart
      }
  });
});
