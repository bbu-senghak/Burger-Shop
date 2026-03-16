const menu = document.querySelector("#menu-icon");
const navbar = document.querySelector(".navbar");
const darkmode = document.querySelector("#darkmode");
const header = document.querySelector("header");
const API_BASE_URL = window.HAK_API_BASE_URL || "http://localhost:3000";
const navLinks = document.querySelectorAll(".nav-link");
const navEntries = Array.from(navLinks)
  .map((link) => {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) return null;
    const target = document.querySelector(href);
    if (!target) return null;
    return { link, target };
  })
  .filter(Boolean);

if (menu && navbar) {
  menu.onclick = () => {
    menu.classList.toggle("bx-x");
    navbar.classList.toggle("active");
  };
}

const setActiveNav = (forcedId) => {
  let activeLink = null;

  if (forcedId) {
    activeLink = document.querySelector(`.navbar a[href="#${forcedId}"]`);
  }

  if (!activeLink) {
    const marker = (header?.offsetHeight || 90) + 24;
    let currentEntry = null;

    navEntries.forEach((entry) => {
      const rect = entry.target.getBoundingClientRect();
      if (rect.top <= marker && rect.bottom > marker) {
        currentEntry = entry;
      }
    });

    if (!currentEntry) {
      for (let i = navEntries.length - 1; i >= 0; i -= 1) {
        if (navEntries[i].target.getBoundingClientRect().top <= marker) {
          currentEntry = navEntries[i];
          break;
        }
      }
    }

    activeLink = currentEntry?.link || navEntries[0]?.link || null;
  }

  if (activeLink) {
    document
      .querySelectorAll(".navbar a.active")
      .forEach((navLink) => navLink.classList.remove("active"));
    activeLink.classList.add("active");
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeMenuItem(row) {
  return {
    itemCode: row.ITEM_CODE || row.itemCode || "",
    itemName: row.ITEM_NAME || row.itemName || "Unnamed Item",
    price: Number(row.PRICE ?? row.price ?? 0),
    discount: Number(row.DISCOUNT ?? row.discount ?? 0),
    image: row.IMAGE || row.image || "./asset/img/menu1.png",
  };
}

const FEATURED_MENU_CONFIG = {
  mode: 'auto', // Change to 'manual' to pick specific items
  manualItemCodes: ['B1004', 'B1008', 'C0001'] // Put your desired itemCodes here
};

function pickFeaturedLandingItems(allItems) {
  if (!Array.isArray(allItems) || allItems.length === 0) return [];

  const used = new Set();
  const pickBy = (predicate) => {
    const item = allItems.find((candidate) => !used.has(candidate.itemCode) && predicate(candidate));
    if (item) used.add(item.itemCode);
    return item || null;
  };

  const featured = [];

  if (FEATURED_MENU_CONFIG.mode === 'manual') {
    FEATURED_MENU_CONFIG.manualItemCodes.forEach(code => {
      featured.push(pickBy(item => String(item.itemCode).toUpperCase() === String(code).toUpperCase()));
    });
  } else {
    featured.push(
      pickBy((item) => String(item.itemName).toLowerCase() === "cheese burger (large)") ||
        pickBy((item) => String(item.itemName).toLowerCase().includes("cheese burger"))
    );
    featured.push(
      pickBy((item) => String(item.itemName).toLowerCase() === "submarine") ||
        pickBy((item) => String(item.itemName).toLowerCase().includes("submarine"))
    );
    featured.push(
      pickBy((item) => String(item.itemName).toLowerCase() === "chicken burger") ||
        pickBy((item) => String(item.itemName).toLowerCase().includes("chicken burger"))
    );
  }

  const withFallback = featured.filter(Boolean);
  if (withFallback.length < 3) {
    allItems.forEach((item) => {
      if (withFallback.length >= 3) return;
      if (used.has(item.itemCode)) return;
      used.add(item.itemCode);
      withFallback.push(item);
    });
  }

  return withFallback.slice(0, 3);
}

function renderLandingMenu(items) {
  const menuContainer = document.querySelector("#menu .menu-container");
  if (!menuContainer || !Array.isArray(items) || items.length === 0) return;

  const topItems = pickFeaturedLandingItems(items);
  menuContainer.innerHTML = topItems
    .map((item) => {
      const cleanName = escapeHtml(item.itemName || "Menu Item");
      const cleanImage = escapeHtml(item.image);
      const basePrice = Number(item.price || 0);
      const hasDiscount = Number(item.discount || 0) > 0;

      return `
        <div class="box">
          <div class="box-img">
            <img src="${cleanImage}" alt="${cleanName}">
          </div>
          <h2>${cleanName}</h2>
          <span>riel ${basePrice.toFixed(2)}</span>
          ${hasDiscount ? `<p class="menu-discount">Discount ${Number(item.discount).toFixed(0)}%</p>` : ""}
          <i class='bx bx-cart-alt'></i>
        </div>
      `;
    })
    .join("");
}

async function loadLandingMenuItems() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/public/items?limit=120&_=${Date.now()}`, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok || !Array.isArray(payload) || payload.length === 0) {
      throw new Error((payload && payload.message) || "No items returned");
    }

    renderLandingMenu(payload.map(normalizeMenuItem));
  } catch (error) {
    console.warn("Using static homepage menu. Reason:", error.message);
  }
}

let menuRefreshTimer = null;

window.addEventListener("scroll", () => {
  if (navbar) {
    navbar.classList.remove("active");
  }
  if (menu) {
    menu.classList.remove("bx-x");
  }
  if (header) {
    header.classList.toggle("scrolled", window.scrollY > 12);
  }
  setActiveNav();
});

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.replace("#", "");
  if (hash) {
    setActiveNav(hash);
  }
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    setActiveNav(href.replace("#", ""));
  });
});

if (darkmode) {
  darkmode.onclick = () => {
    if (darkmode.classList.contains("bx-moon")) {
      darkmode.classList.replace("bx-moon", "bx-sun");
      document.body.classList.add("active");
    } else {
      darkmode.classList.replace("bx-sun", "bx-moon");
      document.body.classList.remove("active");
    }
  };
}

const sr = ScrollReveal({
  origin: "top",
  distance: "40px",
  duration: 1300,
  reset: true,
});

sr.reveal(
  ".heading, .home-text, .home-img, .about-img, .about-text, .box, .s-box, .btn, .connect-text, .contact-box, .footer-box, .footer-content",
  { interval: 170 }
);

document.addEventListener("DOMContentLoaded", () => {
  const contactForm = document.getElementById("contact-form");
  const formMessage = document.getElementById("form-message");
  const submitBtn = document.getElementById("contact-submit-btn");

  if (contactForm && formMessage) {
    contactForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(contactForm);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phoneNumber: String(formData.get("phoneNumber") || "").trim(),
        subject: String(formData.get("subject") || "").trim(),
        message: String(formData.get("message") || "").trim(),
      };

      if (!payload.name || !payload.email || !payload.phoneNumber || !payload.subject || !payload.message) {
        formMessage.textContent = "Please complete all fields before sending.";
        formMessage.classList.add("error");
        return;
      }

      const previousButtonText = submitBtn ? submitBtn.textContent : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
      }
      formMessage.textContent = "Submitting your message...";
      formMessage.classList.remove("error");

      try {
        const response = await fetch(`${API_BASE_URL}/api/public/contact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Failed to send message.");
        }

        formMessage.textContent = result.message || "Message sent successfully!";
        formMessage.classList.remove("error");
        contactForm.reset();
      } catch (error) {
        formMessage.textContent = error.message || "Failed to send message.";
        formMessage.classList.add("error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = previousButtonText || "Send Message";
        }
      }
    });
  }

  const hash = window.location.hash.replace("#", "");
  setActiveNav(hash || null);
  loadLandingMenuItems();
  if (!menuRefreshTimer) {
    menuRefreshTimer = window.setInterval(loadLandingMenuItems, 30000);
  }
  window.addEventListener("focus", loadLandingMenuItems);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadLandingMenuItems();
    }
  });
});
