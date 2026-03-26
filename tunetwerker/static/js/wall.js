/**
 * wall.js — The Wall: cart player / hot-key sound board
 * Cart banks map to RadioDJ's cart_banks / carts tables.
 * Each cart button plays the associated audio via Web Audio API.
 * Squirrel FM | GPL v3 | No ads. Ever.
 */

"use strict";

(function Wall() {

  // ── State ─────────────────────────────────────────────────────────────────
  let banks       = [];
  let activeBankId= null;
  let cartAudios  = {};     // { cart_id: HTMLAudioElement }
  let cartPlaying = {};     // { cart_id: bool }
  let cartProgress= {};     // { cart_id: interval }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const bankTabsEl   = document.getElementById("wallBankTabs");
  const wallGrid     = document.getElementById("wallGrid");
  const wallEmptyEl  = document.getElementById("wallEmpty");
  const wallReloadBtn= document.getElementById("wallReloadBtn");

  // ── Load cart banks from server ───────────────────────────────────────────
  async function loadBanks() {
    try {
      banks = await API.get("/api/carts");
      renderBankTabs();
      if (banks.length) {
        selectBank(banks[0].id);
      } else {
        wallGrid.innerHTML = "";
        wallEmptyEl.style.display = "";
        wallEmptyEl.textContent = "No cart banks configured.";
      }
    } catch(e) {
      wallEmptyEl.style.display = "";
      wallEmptyEl.textContent   = "Failed to load carts.";
      console.warn("Cart load failed:", e);
    }
  }

  // ── Bank tabs ─────────────────────────────────────────────────────────────
  function renderBankTabs() {
    bankTabsEl.innerHTML = "";
    banks.forEach(bank => {
      const btn = document.createElement("button");
      btn.className   = "btn btn-sm wall-bank-tab";
      btn.textContent = bank.name || `Bank ${bank.id}`;
      btn.dataset.bankId = bank.id;
      btn.addEventListener("click", () => selectBank(bank.id));
      bankTabsEl.appendChild(btn);
    });
  }

  function selectBank(bankId) {
    activeBankId = bankId;
    bankTabsEl.querySelectorAll(".wall-bank-tab").forEach(btn => {
      btn.classList.toggle("active", parseInt(btn.dataset.bankId) === bankId);
    });
    loadBankCarts(bankId);
  }

  // ── Load carts for a bank ─────────────────────────────────────────────────
  async function loadBankCarts(bankId) {
    try {
      const bank = await API.get(`/api/carts/${bankId}`);
      renderCarts(bank.carts ?? []);
    } catch(e) {
      wallGrid.innerHTML = "";
      wallEmptyEl.style.display = "";
      wallEmptyEl.textContent = "Failed to load cart bank.";
    }
  }

  // ── Render cart buttons ───────────────────────────────────────────────────
  function renderCarts(carts) {
    wallEmptyEl.style.display = "none";
    // Stop any playing carts from previous bank
    Object.keys(cartAudios).forEach(stopCart);
    cartAudios  = {};
    cartPlaying = {};

    if (!carts.length) {
      wallGrid.innerHTML = "";
      wallEmptyEl.style.display = "";
      wallEmptyEl.textContent = "This bank has no carts.";
      return;
    }

    // Build 4×N grid — show up to 32 carts per bank
    const slots = 32;
    const displayed = carts.slice(0, slots);
    const htmlArr = [];

    for (let i = 0; i < slots; i++) {
      const cart = displayed[i] || null;
      if (cart) {
        const typeCls = songTypeClass(cart.song_type ?? 1);
        const dur     = fmtDur(cart.duration);
        const colorStyle = cart.colour ? `background: ${cart.colour};` : "";

        htmlArr.push(`
          <div class="cart-btn ${typeCls}" data-cart-id="${cart.id}" data-song-id="${cart.song_id}" title="${escHtml(cart.title || '')}">
            <div class="cart-inner" style="${colorStyle}">
              <div class="cart-label">${escHtml(cart.title || "—")}</div>
              <div class="cart-artist">${escHtml(cart.artist || "")}</div>
              <div class="cart-dur">${dur}</div>
              <div class="cart-progress-bar" id="cp_${cart.id}"></div>
            </div>
          </div>`);
      } else {
        htmlArr.push(`<div class="cart-btn cart-empty"></div>`);
      }
    }

    wallGrid.innerHTML = htmlArr.join("");

    // Bind click handlers
    wallGrid.querySelectorAll(".cart-btn[data-cart-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const cartId  = parseInt(btn.dataset.cartId);
        const songId  = parseInt(btn.dataset.songId);
        toggleCart(cartId, songId, btn);
      });
    });
  }

  // ── Cart playback ─────────────────────────────────────────────────────────
  async function toggleCart(cartId, songId, btnEl) {
    if (cartPlaying[cartId]) {
      stopCart(cartId);
      return;
    }
    playCart(cartId, songId, btnEl);
  }

  async function playCart(cartId, songId, btnEl) {
    // Stop any other cart that might be playing (one at a time per default)
    // Comment out if you want polyphonic carts
    // Object.keys(cartPlaying).forEach(id => stopCart(parseInt(id)));

    if (!cartAudios[cartId]) {
      const audio = new Audio(`/audio/${songId}`);
      audio.preload = "auto";
      cartAudios[cartId] = audio;
    }

    const audio = cartAudios[cartId];
    audio.currentTime = 0;

    try {
      await audio.play();
    } catch(e) {
      toast("Playback failed: " + e.message, "error");
      return;
    }

    cartPlaying[cartId] = true;
    btnEl.classList.add("playing");

    const progressEl = document.getElementById(`cp_${cartId}`);

    // Animate progress bar
    cartProgress[cartId] = setInterval(() => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      if (progressEl) progressEl.style.width = pct + "%";
    }, 100);

    audio.onended = () => {
      stopCart(cartId);
    };
    audio.onerror = () => {
      stopCart(cartId);
      toast("Audio error on cart", "error");
    };
  }

  function stopCart(cartId) {
    cartId = parseInt(cartId);
    if (cartAudios[cartId]) {
      cartAudios[cartId].pause();
      cartAudios[cartId].currentTime = 0;
    }
    cartPlaying[cartId] = false;
    clearInterval(cartProgress[cartId]);

    const progressEl = document.getElementById(`cp_${cartId}`);
    if (progressEl) progressEl.style.width = "0%";

    const btnEl = wallGrid.querySelector(`[data-cart-id="${cartId}"]`);
    if (btnEl) btnEl.classList.remove("playing");
  }

  // ── Keyboard shortcuts: F1-F12 trigger first 12 carts in active bank ──────
  document.addEventListener("keydown", e => {
    const panel = document.getElementById("panelWall");
    if (!panel.classList.contains("active")) return;
    if (e.target.tagName === "INPUT") return;

    const fKeyMap = {
      F1:1, F2:2, F3:3, F4:4, F5:5, F6:6,
      F7:7, F8:8, F9:9, F10:10, F11:11, F12:12
    };
    const slot = fKeyMap[e.code];
    if (!slot) return;
    e.preventDefault();

    const btn = wallGrid.querySelector(`.cart-btn[data-cart-id]:nth-child(${slot})`);
    if (btn) btn.click();
  });

  // ── Reload button ─────────────────────────────────────────────────────────
  wallReloadBtn.addEventListener("click", loadBanks);

  // ── Panel activation ──────────────────────────────────────────────────────
  document.addEventListener("tt:panelActive", e => {
    if (e.detail === "panelWall" && !banks.length) {
      loadBanks();
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  loadBanks();

})();
