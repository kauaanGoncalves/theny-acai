import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.0";
const supabase = createClient("https://wyvszpgwqmwdkqaqhsed.supabase.co", "sb_publishable_dNOgfbzU4NLsUYZE0tIVIg_ZEMIHC8z", { auth: { experimental: { passkey: true } } });
const STORAGE_KEY = "theny-acai-orders-v1";
const PENDING_ORDERS_KEY = "theny-acai-pending-orders-v1";
const LOCAL_MIGRATED_KEY = "theny-acai-orders-migrated-v1";
const STOCK_KEY = "theny-acai-stock-v1";
const TOPPINGS_KEY = "theny-acai-toppings-v1";
const SAUCES_KEY = "theny-acai-sauces-v1";
const PRODUCTS_KEY = "theny-acai-products-v1";
const PIX_KEY_STORAGE = "theny-acai-pix-key-v1";
const TOPPING_PRICES_KEY = "theny-acai-topping-prices-v1";
const TOPPING_ADDONS_KEY = "theny-acai-topping-addons-v1";
const SAUCE_ADDONS_KEY = "theny-acai-sauce-addons-v1";
const DEFAULT_TOPPINGS = ["Leite em Pó", "Confete", "Chocobol", "Granulado", "Jujuba", "Granola", "Paçoca"];
const DEFAULT_SAUCES = ["Morango", "Chocolate", "Leite Condensado"];
const DEFAULT_PRODUCTS = [{ id: "potinho", name: "Potinho", icon: "🫙", price: 10, toppingLimit: 3, sauceLimit: 1 }, { id: "copinho", name: "Copinho", icon: "🥤", price: 5, toppingLimit: 3, sauceLimit: 1 }];
const form = document.querySelector("#order-form");
const ordersRoot = document.querySelector("#orders-list");
const toast = document.querySelector("#toast");
let orders = load(STORAGE_KEY, []);
let unavailable = load(STOCK_KEY, []);
let toppings = load(TOPPINGS_KEY, DEFAULT_TOPPINGS);
let sauces = load(SAUCES_KEY, DEFAULT_SAUCES);
let toppingPrices = (() => { try { return JSON.parse(localStorage.getItem(TOPPING_PRICES_KEY) || "{}"); } catch { return {}; } })();
let toppingAddons = load(TOPPING_ADDONS_KEY, []).map(normalizeAddon).filter(Boolean);
let sauceAddons = load(SAUCE_ADDONS_KEY, []).map(normalizeAddon).filter(Boolean);
let products = load(PRODUCTS_KEY, DEFAULT_PRODUCTS).map((item) => { const oldDefault = (item.id === "potinho" && item.toppingLimit === 3 && item.sauceLimit === 2) || (item.id === "copinho" && item.toppingLimit === 1 && item.sauceLimit === 1); return { ...item, toppingLimit: oldDefault ? 3 : item.toppingLimit, sauceLimit: oldDefault ? 1 : item.sauceLimit, price: Number.isFinite(Number(item.price)) ? Number(item.price) : item.id === "copinho" ? 5 : item.id === "potinho" ? 10 : 0, icon: item.id === "potinho" ? "🫙" : item.id === "copinho" ? "🥤" : item.icon, flavors: undefined }; });
let pixKey = localStorage.getItem(PIX_KEY_STORAGE) || "13997891003";
let toastTimer;
let ordersChannel = null;
let shopSettingsChannel = null;
let syncInFlight = false;
let syncRefreshQueued = false;
let shopSettingsReady = false;
let applyingRemoteSettings = false;
let settingsSyncTimer = null;

function load(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return Array.isArray(value) ? value : fallback; } catch { return fallback; } }
function normalizeAddon(item) { if (typeof item === "string") return { name: item, price: 0 }; if (!item || typeof item.name !== "string") return null; return { name: item.name, price: Math.max(0, Number(item.price) || 0) }; }
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); if ([STOCK_KEY, TOPPINGS_KEY, SAUCES_KEY, PRODUCTS_KEY, TOPPING_PRICES_KEY, TOPPING_ADDONS_KEY, SAUCE_ADDONS_KEY].includes(key)) scheduleSettingsSync(); } catch { notify("Não foi possível salvar neste navegador."); } }
function product() { return form.elements.product?.value || products[0]?.id || "potinho"; }
function selected(group) { return [...form.querySelectorAll(`[name="${group}"]:checked`)].map((input) => input.value); }
function isUnavailable(item) { return unavailable.includes(item); }
function formatMoney(value) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0); }
function orderTotal(order) { const productPrice = Number(order.basePrice ?? products.find((item) => item.id === order.product)?.price ?? (order.product === "copinho" ? 5 : order.product === "potinho" ? 10 : 0)); const paid = [...(order.toppings || []), ...(order.sauces || [])].reduce((sum, item) => sum + (typeof item === "string" ? Number(toppingPrices[item]) || 0 : Number(item.price) || 0), 0); return Number(order.total ?? productPrice + paid); }
function localDateKey(date = new Date()) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

function makeOptions(root, values, name) {
  root.replaceChildren(...values.filter((value) => !isUnavailable(value)).map((value) => {
    const label = document.createElement("label"); label.className = "option-row";
    const text = document.createElement("span"); text.textContent = value;
    const input = document.createElement("input"); input.type = "checkbox"; input.name = name; input.value = value;
    const check = document.createElement("span"); check.className = "checkmark";
    label.append(text, input, check); input.addEventListener("change", () => enforceLimit(name));
    return label;
  }));
}
function makeAddonOptions(root, panel, values, name) {
  const available = values.filter((item) => item.price > 0 && !isUnavailable(item.name)); panel.hidden = available.length === 0;
  root.replaceChildren(...available.map((item) => {
    const label = document.createElement("label"); label.className = "option-row paid-addon-row";
    const text = document.createElement("span"); text.textContent = `${item.name} · +${formatMoney(item.price)}`;
    const input = document.createElement("input"); input.type = "checkbox"; input.name = name; input.value = item.name;
    const check = document.createElement("span"); check.className = "checkmark"; label.append(text, input, check); return label;
  }));
}
function selectedAddons(group, list) { return selected(group).map((name) => list.find((item) => item.name === name)).filter(Boolean); }
function migrateLegacyPaidToppings() {
  const names = toppings.filter((name) => (Number(toppingPrices[name]) || 0) > 0 && !toppingAddons.some((item) => item.name === name));
  if (!names.length) return false;
  names.forEach((name) => { toppingAddons.push({ name, price: Number(toppingPrices[name]) || 0 }); delete toppingPrices[name]; });
  toppings = toppings.filter((name) => !names.includes(name));
  persist(TOPPINGS_KEY, toppings); persist(TOPPING_PRICES_KEY, toppingPrices); persist(TOPPING_ADDONS_KEY, toppingAddons); return true;
}

function enforceLimit(group) {
  const currentProduct = products.find((item) => item.id === product()) || products[0];
  if (!currentProduct) return;
  const limit = currentProduct[group === "topping" ? "toppingLimit" : "sauceLimit"];
  const checked = selected(group);
  if (checked.length > limit) {
    [...form.querySelectorAll(`[name="${group}"]:checked`)].at(-1).checked = false;
    notify(`Você pode escolher até ${limit} ${group === "topping" ? "complemento(s)" : "calda(s)"}.`);
  }
  const current = selected(group).length;
  document.querySelector(group === "topping" ? "#topping-counter" : "#sauce-counter").textContent = current ? `${current} de ${limit} escolhido(s)` : `Escolha até ${limit}`;
  form.querySelectorAll(`[name="${group}"]`).forEach((input) => {
    const unavailableItem = isUnavailable(input.value);
    const locked = unavailableItem || (!input.checked && current >= limit);
    input.disabled = locked;
    input.closest(".option-row").classList.toggle("disabled", locked);
    input.closest(".option-row").classList.toggle("unavailable", unavailableItem);
  });
}

function updateProduct() {
  const current = product();
  document.querySelectorAll(".product-option").forEach((card) => card.classList.toggle("selected", card.dataset.product === current));
  enforceLimit("topping"); enforceLimit("sauce");
}

function renderProducts() {
  const root = document.querySelector("#product-options");
  const activeId = product();
  root.replaceChildren(...products.map((item) => {
    const label = document.createElement("label"); label.className = "product-option"; label.dataset.product = item.id;
    const radio = document.createElement("input"); radio.type = "radio"; radio.name = "product"; radio.value = item.id; radio.checked = item.id === activeId;
    const icon = document.createElement("span"); icon.className = "product-emoji"; icon.textContent = item.icon || "🍧";
    const title = document.createElement("span"); title.className = "product-title"; title.textContent = item.name;
    const detail = document.createElement("span"); detail.className = "product-limit"; detail.textContent = `${formatMoney(item.price)} · ${item.toppingLimit} complemento(s) · ${item.sauceLimit} calda(s)`;
    const mark = document.createElement("span"); mark.className = "radio-mark";
    label.append(radio, icon, title, detail, mark); return label;
  }));
  if (!products.some((item) => item.id === activeId) && products.length) form.elements.product.value = products[0].id;
  root.querySelectorAll("input[name=product]").forEach((radio) => radio.addEventListener("change", updateProduct));
}

function notify(message) {
  window.clearTimeout(toastTimer); toast.textContent = message; toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}

function toggleUnavailable(item) {
  unavailable = isUnavailable(item) ? unavailable.filter((value) => value !== item) : [...unavailable, item];
  if (isUnavailable(item)) form.querySelectorAll(".option-row input").forEach((input) => { if (input.value === item) input.checked = false; });
  persist(STOCK_KEY, unavailable); renderStock();
  makeOptions(document.querySelector("#topping-options"), toppings, "topping"); makeOptions(document.querySelector("#sauce-options"), sauces, "sauce"); renderCustomerAddons();
  enforceLimit("topping"); enforceLimit("sauce");
}

function renderStock() {
  [["#topping-stock", toppings], ["#sauce-stock", sauces]].forEach(([selector, items]) => {
    const root = document.querySelector(selector);
    root.replaceChildren(...items.map((item) => {
      const wrap = document.createElement("span"); wrap.className = "stock-item-wrap";
      const button = document.createElement("button"); button.type = "button"; button.className = "stock-chip" + (isUnavailable(item) ? " unavailable" : "");
      button.textContent = item; button.setAttribute("aria-pressed", String(isUnavailable(item)));
      button.setAttribute("aria-label", item + ": " + (isUnavailable(item) ? "indisponível, toque para liberar" : "disponível, toque para riscar"));
      button.addEventListener("click", () => toggleUnavailable(item)); wrap.append(button);
      if (!(selector === "#topping-stock" ? DEFAULT_TOPPINGS : DEFAULT_SAUCES).includes(item)) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-option"; remove.textContent = "×"; remove.setAttribute("aria-label", "Excluir " + item);
        remove.addEventListener("click", () => deleteOption(selector === "#topping-stock" ? "topping" : "sauce", item)); wrap.append(remove);
      }
      return wrap;
    }));
  });
  renderAddonStock("#topping-addon-stock", toppingAddons, "topping"); renderAddonStock("#sauce-addon-stock", sauceAddons, "sauce");
  const productRoot = document.querySelector("#product-stock");
  productRoot.replaceChildren(...products.map((item) => {
    const chip = document.createElement("span"); chip.className = "stock-chip product-chip"; chip.textContent = (item.icon || "🍧") + " " + item.name;
    if (item.id !== "potinho" && item.id !== "copinho") {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-product"; remove.textContent = "×"; remove.setAttribute("aria-label", "Excluir " + item.name);
      remove.addEventListener("click", () => deleteProduct(item.id)); chip.append(remove);
    }
    return chip;
  }));
  renderProductLimits();
  renderPix();
}

function addOption(kind, value) {
  const list = kind === "topping" ? toppings : sauces;
  if (list.some((entry) => entry.toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR"))) { notify("Essa opção já existe."); return; }
  if (kind === "topping") { toppings = [...toppings, value]; persist(TOPPINGS_KEY, toppings); }
  else { sauces = [...sauces, value]; persist(SAUCES_KEY, sauces); }
  renderStock(); makeOptions(document.querySelector(kind === "topping" ? "#topping-options" : "#sauce-options"), listFor(kind), kind); enforceLimit(kind); notify("Opção adicionada!");
}
function addonList(kind) { return kind === "topping" ? toppingAddons : sauceAddons; }
function saveAddonList(kind, list) { if (kind === "topping") { toppingAddons = list; persist(TOPPING_ADDONS_KEY, list); } else { sauceAddons = list; persist(SAUCE_ADDONS_KEY, list); } }
function addAddonOption(kind, name, price) {
  const list = addonList(kind);
  if (list.some((entry) => entry.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) { notify("Esse adicional já existe."); return; }
  saveAddonList(kind, [...list, { name, price: Math.max(0, Number(price) || 0) }]); renderStock(); renderCustomerAddons(); notify("Adicional cadastrado!");
}
function renderAddonStock(selector, items, kind) {
  const root = document.querySelector(selector); if (!root) return;
  root.replaceChildren(...items.map((item) => {
    const wrap = document.createElement("span"); wrap.className = "stock-item-wrap addon-stock-item";
    const button = document.createElement("button"); button.type = "button"; button.className = "stock-chip addon-chip" + (isUnavailable(item.name) ? " unavailable" : "");
    button.textContent = `${item.name} · ${formatMoney(item.price)}`; button.setAttribute("aria-pressed", String(isUnavailable(item.name)));
    button.setAttribute("aria-label", `${item.name}, ${formatMoney(item.price)}: ` + (isUnavailable(item.name) ? "indisponível, toque para liberar" : "disponível, toque para riscar"));
    button.addEventListener("click", () => toggleUnavailable(item.name)); wrap.append(button);
    const priceForm = document.createElement("form"); priceForm.className = "stock-price-form";
    const priceInput = document.createElement("input"); priceInput.type = "number"; priceInput.min = "0.01"; priceInput.step = "0.50"; priceInput.value = Number(item.price).toFixed(2); priceInput.setAttribute("aria-label", `Preço de ${item.name}`);
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Salvar"; priceForm.append(priceInput, save);
    priceForm.addEventListener("submit", (event) => { event.preventDefault(); const price = Number(priceInput.value); if (!(price > 0)) { notify("Informe um preço maior que zero."); return; } saveAddonList(kind, addonList(kind).map((entry) => entry.name === item.name ? { ...entry, price } : entry)); renderStock(); renderCustomerAddons(); updateOrderPrice(); notify("Preço atualizado."); }); wrap.append(priceForm);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-option"; remove.textContent = "×"; remove.setAttribute("aria-label", `Excluir adicional ${item.name}`);
    remove.addEventListener("click", () => { saveAddonList(kind, addonList(kind).filter((entry) => entry.name !== item.name)); renderStock(); renderCustomerAddons(); updateOrderPrice(); }); wrap.append(remove);
    return wrap;
  }));
}
function renderCustomerAddons() {
  makeAddonOptions(document.querySelector("#topping-addon-options"), document.querySelector("#topping-addon-panel"), toppingAddons, "toppingAddon");
  makeAddonOptions(document.querySelector("#sauce-addon-options"), document.querySelector("#sauce-addon-panel"), sauceAddons, "sauceAddon");
}
function listFor(kind) { return kind === "topping" ? toppings : sauces; }
function deleteOption(kind, value) {
  if (kind === "topping") { toppings = toppings.filter((item) => item !== value); delete toppingPrices[value]; persist(TOPPINGS_KEY, toppings); persist(TOPPING_PRICES_KEY, toppingPrices); }
  else { sauces = sauces.filter((item) => item !== value); persist(SAUCES_KEY, sauces); }
  unavailable = unavailable.filter((item) => item !== value); persist(STOCK_KEY, unavailable);
  renderStock(); makeOptions(document.querySelector(kind === "topping" ? "#topping-options" : "#sauce-options"), listFor(kind), kind); enforceLimit(kind);
}
function renderProductLimits() {
  const root = document.querySelector("#product-limits");
  root.replaceChildren(...products.map((item) => {
    const editForm = document.createElement("form"); editForm.className = "product-limit-form";
    const title = document.createElement("strong"); title.textContent = item.name;
    const toppingLabel = document.createElement("label"); toppingLabel.textContent = "Complementos";
    const toppingInput = document.createElement("input"); toppingInput.type = "number"; toppingInput.min = "0"; toppingInput.max = "10"; toppingInput.value = String(item.toppingLimit); toppingInput.setAttribute("aria-label", "Limite de complementos para " + item.name);
    const sauceLabel = document.createElement("label"); sauceLabel.textContent = "Caldas";
    const sauceInput = document.createElement("input"); sauceInput.type = "number"; sauceInput.min = "0"; sauceInput.max = "10"; sauceInput.value = String(item.sauceLimit); sauceInput.setAttribute("aria-label", "Limite de caldas para " + item.name);
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Salvar";
    editForm.append(title, toppingLabel, toppingInput, sauceLabel, sauceInput, save);
    editForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const toppingLimit = Number(toppingInput.value), sauceLimit = Number(sauceInput.value);
      if (!Number.isInteger(toppingLimit) || !Number.isInteger(sauceLimit) || toppingLimit < 0 || sauceLimit < 0 || toppingLimit > 10 || sauceLimit > 10) { notify("Use limites entre 0 e 10."); return; }
      products = products.map((productItem) => productItem.id === item.id ? { ...productItem, toppingLimit, sauceLimit } : productItem);
      persist(PRODUCTS_KEY, products); renderProducts(); updateProduct(); renderStock(); notify("Limites atualizados.");
    });
    return editForm;
  }));
}
function renderPix() {
  const display = document.querySelector("#pix-key-display");
  const input = document.querySelector("#pix-key-input");
  if (display) display.textContent = pixKey || "Chave não configurada";
  if (input && document.activeElement !== input) input.value = pixKey;
}
document.querySelector("#pix-form").addEventListener("submit", (event) => {
  event.preventDefault(); pixKey = document.querySelector("#pix-key-input").value.trim();
  localStorage.setItem(PIX_KEY_STORAGE, pixKey); scheduleSettingsSync(); renderPix(); notify("Chave Pix salva e enviada para sincronização.");
});
document.querySelector("#copy-pix").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(pixKey); notify("Chave Pix copiada."); }
  catch { notify("Não foi possível copiar. Anote a chave exibida no rodapé."); }
});
function deleteProduct(id) {
  products = products.filter((item) => item.id !== id); persist(PRODUCTS_KEY, products);
  renderProducts(); updateProduct(); renderStock();
}
function addProduct(name, icon, price = 0) {
  if (products.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) { notify("Esse produto já existe."); return; }
  const id = `produto-${Date.now()}`;
  products = [...products, { id, name, icon, price: Math.max(0, Number(price) || 0), toppingLimit: 3, sauceLimit: 1 }]; persist(PRODUCTS_KEY, products);
  renderProducts(); form.elements.product.value = id; updateProduct(); renderStock(); notify("Produto cadastrado!");
}

function makeOrderCard(order) {
  const card = document.createElement("article"); card.className = `order-item${order.done ? " done" : ""}`;
  const top = document.createElement("div"); top.className = "order-top";
  const info = document.createElement("div");
  const name = document.createElement("p"); name.className = "order-name"; name.textContent = order.name;
  if (order.done) { const badge = document.createElement("span"); badge.className = "order-state"; badge.textContent = "REALIZADO"; name.append(badge); }
  const time = document.createElement("time"); time.className = "order-time"; time.dateTime = order.createdAt;
  time.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(order.createdAt));
  info.append(name, time);
  if (currentRole === "orders_viewer") top.append(info);
  else {
    const remove = document.createElement("button"); remove.className = "remove-order"; remove.type = "button"; remove.textContent = "×";
    remove.setAttribute("aria-label", `Excluir pedido de ${order.name}`);
    remove.addEventListener("click", () => { void deleteCloudOrder(order); });
    top.append(info, remove);
  }
  const productTag = document.createElement("span"); productTag.className = "order-product";
  productTag.textContent = `${order.productIcon || "🍧"} ${order.productName || order.product}`;
  const detail = document.createElement("p"); detail.className = "order-detail";
  const toppingItems = (order.toppings || []).map((item) => typeof item === "string" ? { name: item, paid: false } : item);
  const sauceItems = (order.sauces || []).map((item) => typeof item === "string" ? { name: item, paid: false } : item);
  const freeToppings = toppingItems.filter((item) => !item.paid).map((item) => item.name);
  const paidToppings = toppingItems.filter((item) => item.paid).map((item) => `${item.name} (+${formatMoney(item.price)})`);
  const freeSauces = sauceItems.filter((item) => !item.paid).map((item) => item.name);
  const paidSauces = sauceItems.filter((item) => item.paid).map((item) => `${item.name} (+${formatMoney(item.price)})`);
  detail.textContent = `Complementos: ${freeToppings.join(", ") || "nenhum"} · Caldas: ${freeSauces.join(", ") || "nenhuma"}`;
  const price = document.createElement("p"); price.className = "order-total-detail"; price.textContent = `Total: ${formatMoney(orderTotal(order))}`;
  card.append(top, productTag, detail);
  if (paidToppings.length) { const extra = document.createElement("p"); extra.className = "order-detail paid-order-detail"; extra.textContent = `Adicionais de complemento: ${paidToppings.join(", ")}`; card.append(extra); }
  if (paidSauces.length) { const extra = document.createElement("p"); extra.className = "order-detail paid-order-detail"; extra.textContent = `Adicionais de calda: ${paidSauces.join(", ")}`; card.append(extra); }
  card.append(price);
  if (order.done) { const served = document.createElement("p"); served.className = "order-served"; served.textContent = `Atendido por ${order.servedBy || "vendedora"}${order.doneAt ? " · " + new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(order.doneAt)) : ""}`; card.append(served); }
  if (order.note) { const note = document.createElement("p"); note.className = "order-note"; note.textContent = `Obs.: ${order.note}`; card.append(note); }
  if (currentRole !== "orders_viewer") {
    if (!order.done) {
      const done = document.createElement("button"); done.className = "status-button"; done.type = "button"; done.textContent = "✓ Marcar como realizado";
      done.addEventListener("click", async () => { const doneAt = new Date().toISOString(); const servedBy = currentSellerName || authUser?.email || "vendedora"; if (!await saveCloudOrderState(order, { done: true, done_at: doneAt, served_by: servedBy })) return; orders = orders.map((item) => item.id === order.id ? { ...item, done: true, doneAt, servedBy } : item); persist(STORAGE_KEY, orders); renderOrders(); });
      card.append(done);
    } else {
      const undo = document.createElement("button"); undo.className = "status-button"; undo.type = "button"; undo.textContent = "↶ Reabrir pedido";
      undo.addEventListener("click", async () => { if (!await saveCloudOrderState(order, { done: false, done_at: null, served_by: null })) return; orders = orders.map((item) => { if (item.id !== order.id) return item; const reopened = { ...item, done: false }; delete reopened.doneAt; delete reopened.servedBy; return reopened; }); persist(STORAGE_KEY, orders); renderOrders(); });
      card.append(undo);
    }
  }
  return card;
}

function renderOrders() {
  const activeOrders = orders.filter((order) => !order.done);
  ordersRoot.replaceChildren(...activeOrders.map(makeOrderCard));
  document.querySelector("#order-count").textContent = String(activeOrders.length);
  document.querySelector("#orders-empty").hidden = activeOrders.length > 0;
  renderHistory();
}
function renderHistory() {
  const dateInput = document.querySelector("#history-date");
  if (!dateInput.value) dateInput.value = localDateKey();
  const completed = orders.filter((order) => order.done && localDateKey(order.doneAt || order.createdAt) === dateInput.value);
  const historyRoot = document.querySelector("#history-list");
  historyRoot.replaceChildren(...completed.map(makeOrderCard));
  document.querySelector("#history-order-count").textContent = String(completed.length);
  document.querySelector("#history-customer-count").textContent = String(new Set(completed.map((order) => order.name.trim().toLocaleLowerCase("pt-BR"))).size);
  document.querySelector("#history-empty").hidden = completed.length > 0;
}
function updateOrderPrice() {
  const chosenProduct = products.find((item) => item.id === product());
  const legacyExtra = selected("topping").reduce((sum, name) => sum + (Number(toppingPrices[name]) || 0), 0);
  const addonsTotal = [...selectedAddons("toppingAddon", toppingAddons), ...selectedAddons("sauceAddon", sauceAddons)].reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  document.querySelector("#order-total").textContent = formatMoney((Number(chosenProduct?.price) || 0) + legacyExtra + addonsTotal);
}

let authUser = null;
let sellerApproved = false;
let sellerIsOwner = false;
let currentRole = null;
let currentSellerName = "";
let signupMode = false;
let accessCheckId = 0;


function showOrdersSyncStatus(message, error = false) {
  const node = document.querySelector("#orders-sync-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("sync-error", error);
}
function shopSettingsSnapshot() {
  return { products, toppings, sauces, unavailable, toppingPrices, toppingAddons, sauceAddons, pixKey };
}
function applyShopSettings(payload) {
  if (!payload || typeof payload !== "object") return;
  applyingRemoteSettings = true;
  if (Array.isArray(payload.products) && payload.products.length) {
    products = payload.products.map((item) => { const oldDefault = (item.id === "potinho" && item.toppingLimit === 3 && item.sauceLimit === 2) || (item.id === "copinho" && item.toppingLimit === 1 && item.sauceLimit === 1); return { ...item, toppingLimit: oldDefault ? 3 : item.toppingLimit, sauceLimit: oldDefault ? 1 : item.sauceLimit, price: Number(item.price) || 0, icon: item.id === "potinho" ? "🫙" : item.id === "copinho" ? "🥤" : item.icon }; });
    persist(PRODUCTS_KEY, products);
  }
  if (Array.isArray(payload.toppings)) { toppings = payload.toppings.filter((item) => typeof item === "string"); persist(TOPPINGS_KEY, toppings); }
  if (Array.isArray(payload.sauces)) { sauces = payload.sauces.filter((item) => typeof item === "string"); persist(SAUCES_KEY, sauces); }
  if (Array.isArray(payload.unavailable)) { unavailable = payload.unavailable.filter((item) => typeof item === "string"); persist(STOCK_KEY, unavailable); }
  if (payload.toppingPrices && typeof payload.toppingPrices === "object" && !Array.isArray(payload.toppingPrices)) { toppingPrices = payload.toppingPrices; persist(TOPPING_PRICES_KEY, toppingPrices); }
  if (Array.isArray(payload.toppingAddons)) { toppingAddons = payload.toppingAddons.map(normalizeAddon).filter(Boolean); persist(TOPPING_ADDONS_KEY, toppingAddons); }
  if (Array.isArray(payload.sauceAddons)) { sauceAddons = payload.sauceAddons.map(normalizeAddon).filter(Boolean); persist(SAUCE_ADDONS_KEY, sauceAddons); }
  if (typeof payload.pixKey === "string") { pixKey = payload.pixKey; localStorage.setItem(PIX_KEY_STORAGE, pixKey); }
  const migrated = migrateLegacyPaidToppings(); applyingRemoteSettings = false; if (migrated) scheduleSettingsSync();
  renderProducts();
  makeOptions(document.querySelector("#topping-options"), toppings, "topping");
  makeOptions(document.querySelector("#sauce-options"), sauces, "sauce");
  renderCustomerAddons();
  updateProduct();
  updateOrderPrice();
  renderStock();
  renderOrders();
}
function scheduleSettingsSync() {
  if (applyingRemoteSettings || !shopSettingsReady || !sellerApproved || !["owner", "editor"].includes(currentRole)) return;
  window.clearTimeout(settingsSyncTimer);
  settingsSyncTimer = window.setTimeout(syncShopSettingsToCloud, 350);
}
async function syncShopSettingsToCloud() {
  if (!sellerApproved || !["owner", "editor"].includes(currentRole)) return;
  const { error } = await supabase.from("theny_shop_state").upsert({ id: "main", payload: shopSettingsSnapshot(), updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) showOrdersSyncStatus("As opções deste aparelho não sincronizaram. Verifique a migração do Supabase e a conexão.", true);
  else showOrdersSyncStatus("Cardápio, estoque e pedidos sincronizados entre aparelhos.");
}
async function loadShopSettingsFromCloud({ seedIfEmpty = false } = {}) {
  const { data, error } = await supabase.from("theny_shop_state").select("payload").eq("id", "main").maybeSingle();
  if (error) {
    showOrdersSyncStatus("Sincronização pendente: execute o script SQL de sincronização no Supabase.", true);
    return false;
  }
  if (data?.payload) {
    applyShopSettings(data.payload);
    shopSettingsReady = true;
    return true;
  }
  shopSettingsReady = true;
  if (seedIfEmpty && sellerApproved && ["owner", "editor"].includes(currentRole)) await syncShopSettingsToCloud();
  return true;
}
async function startShopSettingsRealtime() {
  if (shopSettingsChannel) return;
  shopSettingsChannel = supabase.channel("theny-shop-state-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "theny_shop_state" }, () => { void loadShopSettingsFromCloud(); })
    .subscribe();
}
function toCloudOrder(order) {
  return {
    id: String(order.id), customer_name: order.name, product_id: order.product,
    product_name: order.productName || order.product, product_icon: order.productIcon || "🍧",
    toppings: order.toppings || [], sauces: order.sauces || [], note: order.note || "",
    base_price: Number(order.basePrice) || 0, total: orderTotal(order), done: Boolean(order.done),
    done_at: order.doneAt || null, served_by: order.servedBy || null, created_at: order.createdAt || new Date().toISOString()
  };
}
function fromCloudOrder(row) {
  return {
    id: row.id, name: row.customer_name, product: row.product_id, productName: row.product_name,
    productIcon: row.product_icon, toppings: row.toppings || [], sauces: row.sauces || [],
    note: row.note || "", basePrice: Number(row.base_price) || 0, total: Number(row.total) || 0,
    done: Boolean(row.done), doneAt: row.done_at, servedBy: row.served_by, createdAt: row.created_at
  };
}
async function fetchCloudOrders() {
  if (!sellerApproved) return;
  if (syncInFlight) { syncRefreshQueued = true; return; }
  syncInFlight = true;
  const { data, error } = await supabase.from("theny_orders").select("*").order("created_at", { ascending: false });
  syncInFlight = false;
  if (error) showOrdersSyncStatus("Não foi possível carregar os pedidos compartilhados. Verifique a migração e a conexão.", true);
  else {
    const cloudOrders = (data || []).map(fromCloudOrder);
    const retained = [...load(PENDING_ORDERS_KEY, [])];
    if (localStorage.getItem(LOCAL_MIGRATED_KEY) !== "true") retained.push(...load(STORAGE_KEY, []));
    const byId = new Map(cloudOrders.map((order) => [String(order.id), order]));
    retained.forEach((order) => { if (!byId.has(String(order.id))) byId.set(String(order.id), order); });
    orders = [...byId.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    persist(STORAGE_KEY, orders);
    renderOrders();
    showOrdersSyncStatus("Pedidos e histórico sincronizados entre aparelhos.");
  }
  if (syncRefreshQueued) { syncRefreshQueued = false; void fetchCloudOrders(); }
}
async function migrateLocalOrdersToCloud() {
  if (localStorage.getItem(LOCAL_MIGRATED_KEY) === "true") return true;
  const localOrders = load(STORAGE_KEY, []);
  if (!localOrders.length) { localStorage.setItem(LOCAL_MIGRATED_KEY, "true"); return true; }
  if (!sellerApproved || !["owner", "editor"].includes(currentRole)) return false;
  if (localOrders.length) {
    const { error } = await supabase.from("theny_orders").upsert(localOrders.map(toCloudOrder), { onConflict: "id", ignoreDuplicates: true });
    if (error) { showOrdersSyncStatus("Não foi possível migrar os pedidos salvos neste aparelho. Verifique as permissões do Supabase.", true); return false; }
  }
  localStorage.setItem(LOCAL_MIGRATED_KEY, "true");
  return true;
}
async function syncPendingOrdersToCloud() {
  const pending = load(PENDING_ORDERS_KEY, []);
  if (!pending.length) return true;
  const pendingRows = pending.map((order) => { const row = toCloudOrder(order); delete row.done; delete row.done_at; delete row.served_by; return row; });
  const { error } = await supabase.from("theny_orders").upsert(pendingRows, { onConflict: "id", ignoreDuplicates: true });
  if (error) return false;
  persist(PENDING_ORDERS_KEY, []);
  return true;
}
async function startOrdersSync() {
  if (!sellerApproved) return;
  await loadShopSettingsFromCloud({ seedIfEmpty: true });
  const migrated = await migrateLocalOrdersToCloud();
  const pendingSynced = await syncPendingOrdersToCloud();
  await fetchCloudOrders();
  if (!migrated) showOrdersSyncStatus("Parte do histórico local ainda não foi enviada. Confira as permissões do Supabase.", true);
  else if (!pendingSynced) showOrdersSyncStatus("Pedidos salvos offline aguardam envio. Confira a conexão.", true);
  if (!ordersChannel) {
    ordersChannel = supabase.channel("theny-orders-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "theny_orders" }, () => { void fetchCloudOrders(); })
      .subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") showOrdersSyncStatus("Pedidos salvos, mas atualização ao vivo falhou. Confira Realtime no Supabase.", true); });
  }
}
async function saveCloudOrderState(order, changes) {
  if (!sellerApproved || !["owner", "editor"].includes(currentRole)) return false;
  const { data, error } = await supabase.from("theny_orders").update(changes).eq("id", String(order.id)).select("id").maybeSingle();
  if (error || !data) { showOrdersSyncStatus("Não foi possível atualizar este pedido no Supabase. Tente novamente.", true); return false; }
  return true;
}
async function deleteCloudOrder(order) {
  if (!sellerApproved || !["owner", "editor"].includes(currentRole)) return;
  const { data, error } = await supabase.from("theny_orders").delete().eq("id", String(order.id)).select("id").maybeSingle();
  if (error || !data) { showOrdersSyncStatus("Não foi possível excluir este pedido sincronizado.", true); return; }
  orders = orders.filter((item) => item.id !== order.id);
  persist(STORAGE_KEY, orders); renderOrders();
}
async function stopOrdersSync() {
  if (ordersChannel) { await supabase.removeChannel(ordersChannel); ordersChannel = null; }
}

function showAuthStatus(message, error = false) {
  const status = document.querySelector("#seller-auth-status");
  status.textContent = message;
  status.classList.toggle("error", error);
}
function setAuthView({ signedIn = false, approved = false, owner = false, role = null, needsName = false } = {}) {
  document.querySelector("#seller-login-form").hidden = signedIn;
  document.querySelector("#seller-name-form").hidden = !needsName;
  document.querySelector("#seller-passkey-register").hidden = !signedIn;
  document.querySelector("#owner-settings").hidden = !owner;
  document.querySelector("#seller-logout").hidden = !signedIn;
  document.querySelector("#seller-logout-panel").hidden = !signedIn;
  document.querySelector("#seller-content").hidden = !approved;
  document.querySelector("#seller-approvals").hidden = !owner;
  document.querySelector(".vendor-stock").hidden = approved && role === "orders_viewer";
}
async function refreshSellerAccess() {
  const checkId = ++accessCheckId;
  await stopOrdersSync();
  if (checkId !== accessCheckId) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (checkId !== accessCheckId) return;
  authUser = session?.user || null;
  sellerApproved = false; sellerIsOwner = false; currentRole = null; currentSellerName = "";
  if (!authUser) {
    setAuthView();
    showAuthStatus("Entre com uma conta aprovada ou solicite seu cadastro.");
    return;
  }
  setAuthView({ signedIn: true });
  showAuthStatus("Conferindo a aprovação da sua conta…");
  const { data, error } = await supabase.from("seller_access")
    .select("role, approved_at, full_name").eq("user_id", authUser.id).maybeSingle();
  if (checkId !== accessCheckId) return;
  if (error) {
    showAuthStatus("Não foi possível validar o acesso. As regras do Supabase precisam ser instaladas.", true);
    return;
  }
  if (!data?.full_name?.trim()) {
    const metadataName = authUser.user_metadata?.full_name?.trim();
    if (metadataName) {
      const { error: nameSyncError } = await supabase.rpc("update_own_seller_name", { seller_full_name: metadataName });
      if (nameSyncError) {
        document.querySelector("#seller-full-name").value = metadataName;
        setAuthView({ signedIn: true, needsName: true });
        showAuthStatus("Seu nome precisa ser salvo. A administradora deve aplicar a atualização do banco.", true);
        return;
      }
    } else {
      setAuthView({ signedIn: true, needsName: true });
      document.querySelector("#seller-full-name").value = "";
      showAuthStatus("Antes de continuar, informe seu nome completo ou como quer ser identificada.");
      return;
    }
  }
  if (!data?.approved_at) {
    showAuthStatus("Cadastro recebido. A responsável precisa aprovar seu acesso.");
    return;
  }
  sellerApproved = true; sellerIsOwner = data.role === "owner"; currentRole = data.role; currentSellerName = data.full_name?.trim() || authUser.email || "";
  setAuthView({ signedIn: true, approved: true, owner: sellerIsOwner, role: currentRole });
  showAuthStatus(sellerIsOwner ? "Conta administradora conectada." : currentRole === "orders_viewer" ? "Acesso somente para visualizar pedidos." : "Conta aprovada.");
  renderStock(); renderOrders();
  await startOrdersSync();
  if (sellerIsOwner) { await renderSellerApprovals(); await renderSellerAccounts(); }
}
function sellerRoleSelect(selectedRole) {
  const select = document.createElement("select"); select.className = "seller-role-select";
  [["editor", "Editar produtos e gerenciar pedidos"], ["orders_viewer", "Somente visualizar pedidos"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = value === selectedRole; select.append(option);
  });
  return select;
}
function sellerIdentity(seller) {
  const identity = document.createElement("div"); identity.className = "seller-account-identity";
  const name = document.createElement("strong"); name.textContent = seller.full_name || "Nome não informado";
  const email = document.createElement("small"); email.textContent = seller.email;
  identity.append(name, email); return identity;
}
async function removeSellerAccount(seller) {
  if (!window.confirm("Excluir a conta de " + seller.email + "? O acesso será removido e ela precisará se cadastrar novamente para voltar.")) return;
  const { error } = await supabase.rpc("delete_seller_account", { target_user_id: seller.user_id });
  if (error) { showAuthStatus("Não foi possível excluir a conta. Confirme se a migração de permissões foi executada.", true); return; }
  notify("Conta da vendedora excluída."); await renderSellerApprovals(); await renderSellerAccounts();
}
async function renderSellerApprovals() {
  const root = document.querySelector("#seller-approval-list");
  const { data, error } = await supabase.from("seller_access")
    .select("user_id, email, full_name, role, created_at").neq("role", "owner").is("approved_at", null).order("created_at");
  root.replaceChildren();
  if (error) { root.textContent = "Não foi possível carregar as solicitações."; return; }
  if (!data?.length) { root.textContent = "Nenhuma solicitação pendente."; return; }
  data.forEach((seller) => {
    const row = document.createElement("div"); row.className = "seller-approval-row";
    const identity = sellerIdentity(seller), access = sellerRoleSelect(seller.role);
    const approve = document.createElement("button"); approve.type = "button"; approve.textContent = "Aprovar";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "seller-delete-button"; remove.textContent = "Excluir";
    approve.addEventListener("click", async () => {
      approve.disabled = true;
      const { error: updateError } = await supabase.rpc("set_seller_access", { target_user_id: seller.user_id, target_role: access.value, approve: true });
      if (updateError) { showAuthStatus("Não foi possível aprovar. Execute a migração de permissões no Supabase.", true); approve.disabled = false; return; }
      notify("Vendedora aprovada."); await renderSellerApprovals(); await renderSellerAccounts();
    });
    remove.addEventListener("click", () => removeSellerAccount(seller));
    row.append(identity, access, approve, remove); root.append(row);
  });
}
async function renderSellerAccounts() {
  const root = document.querySelector("#seller-account-list");
  const { data, error } = await supabase.from("seller_access")
    .select("user_id, email, full_name, role, approved_at").neq("role", "owner").not("approved_at", "is", null).order("email");
  root.replaceChildren();
  if (error) { root.textContent = "Não foi possível carregar as contas cadastradas."; return; }
  if (!data?.length) { root.textContent = "Nenhuma vendedora aprovada ainda."; return; }
  data.forEach((seller) => {
    const row = document.createElement("div"); row.className = "seller-approval-row";
    const identity = sellerIdentity(seller), access = sellerRoleSelect(seller.role);
    const save = document.createElement("button"); save.type = "button"; save.textContent = "Salvar acesso";
    save.addEventListener("click", async () => {
      save.disabled = true;
      const { error: updateError } = await supabase.rpc("set_seller_access", { target_user_id: seller.user_id, target_role: access.value, approve: null });
      if (updateError) { showAuthStatus("Não foi possível alterar o acesso. Execute a migração no Supabase.", true); save.disabled = false; return; }
      notify("Acesso atualizado."); await renderSellerAccounts();
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "seller-delete-button"; remove.textContent = "Excluir";
    remove.addEventListener("click", () => removeSellerAccount(seller));
    row.append(identity, access, save, remove); root.append(row);
  });
}
async function sellerLogin(event) {
  event.preventDefault();
  const email = document.querySelector("#seller-email").value.trim();
  const password = document.querySelector("#seller-password").value;
  showAuthStatus("Entrando…");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { showAuthStatus("Não foi possível entrar. Confira e-mail e senha.", true); return; }
  await refreshSellerAccess();
}
document.querySelector("#seller-login-form").addEventListener("submit", sellerLogin);
function passkeySupported() {
  return window.isSecureContext && "PublicKeyCredential" in window && !!navigator.credentials;
}
document.querySelector("#seller-passkey-login").addEventListener("click", async () => {
  if (!passkeySupported()) { showAuthStatus("Este navegador ou aparelho não oferece passkeys. Entre com e-mail e senha.", true); return; }
  showAuthStatus("Aguardando a confirmação de biometria ou PIN…");
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) { showAuthStatus("Não foi possível entrar com passkey. Se ainda não cadastrou neste aparelho, entre com e-mail e senha e ative a biometria.", true); return; }
  await refreshSellerAccess();
});
document.querySelector("#seller-passkey-register").addEventListener("click", async () => {
  if (!passkeySupported()) { showAuthStatus("Este navegador ou aparelho não oferece passkeys.", true); return; }
  showAuthStatus("Siga a solicitação do aparelho para cadastrar biometria, PIN ou chave de segurança…");
  const { error } = await supabase.auth.registerPasskey();
  if (error) { showAuthStatus("Não foi possível cadastrar. Confirme seu e-mail e verifique se Passkeys está ativado no Supabase.", true); return; }
  showAuthStatus("Passkey cadastrada. Da próxima vez, você poderá entrar com biometria neste aparelho.");
});
document.querySelector("#seller-name-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fullName = document.querySelector("#seller-full-name").value.trim();
  if (fullName.length < 2 || fullName.length > 100) { showAuthStatus("Informe um nome de 2 a 100 caracteres.", true); return; }
  showAuthStatus("Salvando seu nome…");
  const { error: authError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
  if (authError) { showAuthStatus("Não foi possível salvar seu nome. Tente novamente.", true); return; }
  const { error: profileError } = await supabase.rpc("update_own_seller_name", { seller_full_name: fullName });
  if (profileError) { showAuthStatus("O banco ainda precisa receber a atualização de nomes. Avise a administradora.", true); return; }
  document.querySelector("#seller-name-form").hidden = true;
  notify("Nome salvo."); await refreshSellerAccess();
});
async function requestPasswordReset(email) {
  if (!email) { showAuthStatus("Digite o e-mail para receber o link de redefinição.", true); return; }
  showAuthStatus("Enviando link de redefinição…");
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://kauaangoncalves.github.io/theny-acai/" });
  if (error) {
    const message = /redirect|url/i.test(error.message || "")
      ? "O Supabase bloqueou o endereço. Em Authentication → URL Configuration, defina Site URL como https://kauaangoncalves.github.io/theny-acai/ e adicione https://kauaangoncalves.github.io/theny-acai/** em Redirect URLs."
      : "Não foi possível enviar agora. Confira o e-mail e tente novamente em alguns minutos.";
    showAuthStatus(message, true); return;
  }
  showAuthStatus("Se houver uma conta para esse e-mail, enviaremos um link. Use o e-mail mais recente; cada link só pode ser usado uma vez.");
}
document.querySelector("#seller-forgot-password").addEventListener("click", () => requestPasswordReset(document.querySelector("#seller-email").value.trim()));
document.querySelector("#seller-recovery-email").value = document.querySelector("#seller-email").value.trim();
document.querySelector("#seller-retry-recovery").addEventListener("submit", (event) => {
  event.preventDefault(); requestPasswordReset(document.querySelector("#seller-recovery-email").value.trim());
});
document.querySelector("#seller-reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#seller-new-password").value;
  const confirmation = document.querySelector("#seller-new-password-confirm").value;
  if (password.length < 6 || password !== confirmation) { showAuthStatus("As senhas precisam ter pelo menos 6 caracteres e ser iguais.", true); return; }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) { document.querySelector("#seller-retry-recovery").hidden = false; showAuthStatus("Este link pode ter expirado ou já ter sido usado. Solicite outro link abaixo.", true); return; }
  document.querySelector("#seller-reset-form").hidden = true;
  document.querySelector("#seller-retry-recovery").hidden = true;
  document.querySelector("#seller-login-form").hidden = true;
  showAuthStatus("Senha atualizada. Você já pode acessar o painel.");
  await refreshSellerAccess();
});
document.querySelector("#seller-signup").addEventListener("click", async () => {
  const nameField = document.querySelector("#seller-signup-name");
  const nameLabel = document.querySelector("#seller-signup-name-label");
  if (!signupMode) {
    signupMode = true; nameField.hidden = false; nameLabel.hidden = false;
    document.querySelector("#seller-signup").textContent = "Enviar cadastro";
    document.querySelector("#seller-cancel-signup").hidden = false;
    showAuthStatus("Informe seu nome completo ou como quer ser identificada.");
    nameField.focus(); return;
  }
  const email = document.querySelector("#seller-email").value.trim();
  const password = document.querySelector("#seller-password").value;
  const fullName = nameField.value.trim();
  if (!fullName || fullName.length < 2) { showAuthStatus("Informe seu nome para continuar.", true); nameField.focus(); return; }
  if (!email || password.length < 6) { showAuthStatus("Informe o e-mail e uma senha com pelo menos 6 caracteres.", true); return; }
  showAuthStatus("Enviando solicitação…");
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo: "https://kauaangoncalves.github.io/theny-acai/" } });
  if (error) { showAuthStatus("Não foi possível solicitar o cadastro. Confira os dados e tente novamente.", true); return; }
  signupMode = false; nameField.hidden = true; nameLabel.hidden = true; document.querySelector("#seller-cancel-signup").hidden = true;
  document.querySelector("#seller-signup").textContent = "Solicitar cadastro";
  if (data.session) await refreshSellerAccess();
  else { document.querySelector("#seller-resend").hidden = false; showAuthStatus("Solicitação enviada. Confirme o e-mail; depois, aguarde a aprovação da responsável."); }
});
document.querySelector("#seller-cancel-signup").addEventListener("click", () => {
  signupMode = false; document.querySelector("#seller-signup-name").hidden = true; document.querySelector("#seller-signup-name-label").hidden = true;
  document.querySelector("#seller-cancel-signup").hidden = true; document.querySelector("#seller-signup").textContent = "Solicitar cadastro";
});
document.querySelector("#seller-resend").addEventListener("click", async () => {
  const email = document.querySelector("#seller-email").value.trim();
  if (!email) { showAuthStatus("Informe o e-mail do cadastro.", true); return; }
  showAuthStatus("Reenviando confirmação…");
  const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: "https://kauaangoncalves.github.io/theny-acai/" } });
  if (error) { showAuthStatus("Não foi possível reenviar. Confira o endereço do site nas configurações de Auth do Supabase.", true); return; }
  showAuthStatus("Se o cadastro estiver aguardando confirmação, enviaremos um novo e-mail.");
});
async function sellerLogout() {
  await stopOrdersSync();
  await supabase.auth.signOut();
  authUser = null; sellerApproved = false; sellerIsOwner = false; currentRole = null;
  setAuthView(); showAuthStatus("Você saiu da conta.");
}
document.querySelector("#seller-logout").addEventListener("click", sellerLogout);
document.querySelector("#seller-logout-panel").addEventListener("click", sellerLogout);
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    window.setTimeout(() => {
      if (location.hash !== "#painel") location.hash = "#painel";
      document.querySelector("#seller-login-form").hidden = true;
      document.querySelector("#seller-reset-form").hidden = false;
      document.querySelector("#seller-recovery-email").value = document.querySelector("#seller-email").value.trim();
      document.querySelector("#seller-retry-recovery").hidden = false;
      document.querySelector("#seller-resend").hidden = true;
      showAuthStatus("Digite e confirme sua nova senha.");
    }, 0);
  } else if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
    window.setTimeout(() => { if (location.hash === "#painel") refreshSellerAccess(); }, 0);
  }
});

function renderRoute() {
  const vendor = location.hash === "#painel";
  document.body.classList.toggle("vendor-mode", vendor);
  document.querySelector("#vendor-view").hidden = !vendor;
  document.querySelector("#top").hidden = vendor;
  document.querySelector(".hero-copy").hidden = vendor;
  document.querySelector(".open-badge").hidden = vendor;
  document.querySelector(".footer").hidden = vendor;
  if (vendor) { refreshSellerAccess(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

form.addEventListener("change", (event) => { if (event.target.name === "product") updateProduct(); updateOrderPrice(); });
document.querySelector("#history-date").addEventListener("change", renderHistory);
form.addEventListener("submit", async (event) => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const name = document.querySelector("#customer-name").value.trim();
  if (!name) { document.querySelector("#customer-name").focus(); return; }
  const chosenProduct = products.find((item) => item.id === product());
  const selectedToppings = selected("topping").map((item) => ({ name: item, price: Number(toppingPrices[item]) || 0 }));
  const paidToppings = selectedAddons("toppingAddon", toppingAddons).map((item) => ({ name: item.name, price: item.price, paid: true }));
  const paidSauces = selectedAddons("sauceAddon", sauceAddons).map((item) => ({ name: item.name, price: item.price, paid: true }));
  const basePrice = Number(chosenProduct.price) || 0;
  const total = basePrice + [...selectedToppings, ...paidToppings, ...paidSauces].reduce((sum, item) => sum + item.price, 0);
  const order = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name,
    product: chosenProduct.id, productName: chosenProduct.name, productIcon: chosenProduct.icon, basePrice, total,
    toppings: [...selectedToppings, ...paidToppings], sauces: [...selected("sauce"), ...paidSauces], note: document.querySelector("#order-note").value.trim(), createdAt: new Date().toISOString(), done: false };
  orders.unshift(order); persist(STORAGE_KEY, orders); renderOrders();
  const submitButton = form.querySelector(".submit-button"); submitButton.disabled = true;
  form.reset(); form.elements.product.value = "potinho"; updateProduct(); updateOrderPrice();
  const customerOrderRow = toCloudOrder(order); delete customerOrderRow.done; delete customerOrderRow.done_at; delete customerOrderRow.served_by;
  const { error } = await supabase.from("theny_orders").insert(customerOrderRow);
  submitButton.disabled = false;
  document.querySelector("#customer-name").focus();
  if (error) {
    const pending = load(PENDING_ORDERS_KEY, []); if (!pending.some((item) => String(item.id) === String(order.id))) pending.unshift(order); persist(PENDING_ORDERS_KEY, pending);
    notify("Pedido salvo offline. Ele será enviado quando a conexão com o Supabase voltar.");
  } else notify("Pedido enviado para o painel da vendedora!");
});

document.querySelectorAll(".add-option-form").forEach((addForm) => addForm.addEventListener("submit", (event) => {
  event.preventDefault(); const input = addForm.querySelector(".option-name-input") || addForm.querySelector("input"); const value = input.value.trim();
  if (value) { addOption(addForm.dataset.kind, value); addForm.reset(); }
}));
document.querySelectorAll(".addon-form").forEach((addForm) => addForm.addEventListener("submit", (event) => {
  event.preventDefault(); const name = addForm.querySelector(".addon-name-input").value.trim(); const price = Number(addForm.querySelector(".addon-price-input").value);
  if (!name) return; if (!(price > 0)) { notify("Informe um preço maior que zero."); return; }
  addAddonOption(addForm.dataset.kind, name, price); addForm.reset(); addForm.querySelector(".addon-price-input").value = "0.50";
}));
document.querySelector("#add-product-form").addEventListener("submit", (event) => {
  event.preventDefault(); const name = document.querySelector("#new-product-name").value.trim();
  if (name) { addProduct(name, document.querySelector("#new-product-icon").value, document.querySelector("#new-product-price").value); event.currentTarget.reset(); }
});
window.addEventListener("hashchange", renderRoute);
window.addEventListener("online", async () => { if (sellerApproved) void startOrdersSync(); else { const sent = await syncPendingOrdersToCloud(); if (!sent) notify("Há pedidos offline aguardando conexão com o Supabase."); void loadShopSettingsFromCloud(); } });
migrateLegacyPaidToppings();
renderProducts();
makeOptions(document.querySelector("#topping-options"), toppings, "topping");
makeOptions(document.querySelector("#sauce-options"), sauces, "sauce");
renderCustomerAddons();
updateProduct(); updateOrderPrice(); renderStock(); renderOrders(); renderRoute();
void loadShopSettingsFromCloud();
void startShopSettingsRealtime();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});

