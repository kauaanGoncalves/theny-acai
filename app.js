import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabase = createClient("https://wyvszpgwqmwdkqaqhsed.supabase.co", "sb_publishable_dNOgfbzU4NLsUYZE0tIVIg_ZEMIHC8z");
const STORAGE_KEY = "theny-acai-orders-v1";
const STOCK_KEY = "theny-acai-stock-v1";
const TOPPINGS_KEY = "theny-acai-toppings-v1";
const SAUCES_KEY = "theny-acai-sauces-v1";
const PRODUCTS_KEY = "theny-acai-products-v1";
const DEFAULT_TOPPINGS = ["Leite em Pó", "Confete", "Chocobol", "Granulado", "Jujuba", "Granola", "Paçoca"];
const DEFAULT_SAUCES = ["Morango", "Chocolate", "Leite Condensado"];
const DEFAULT_PRODUCTS = [{ id: "potinho", name: "Potinho", icon: "🍇", toppingLimit: 3, sauceLimit: 2 }, { id: "copinho", name: "Copinho", icon: "🥣", toppingLimit: 1, sauceLimit: 1, flavors: ["Açaí", "Creme"] }];
const form = document.querySelector("#order-form");
const flavorPanel = document.querySelector("#flavor-panel");
const ordersRoot = document.querySelector("#orders-list");
const toast = document.querySelector("#toast");
let orders = load(STORAGE_KEY, []);
let unavailable = load(STOCK_KEY, []);
let toppings = load(TOPPINGS_KEY, DEFAULT_TOPPINGS);
let sauces = load(SAUCES_KEY, DEFAULT_SAUCES);
let products = load(PRODUCTS_KEY, DEFAULT_PRODUCTS);
let toastTimer;

function load(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || "null"); return Array.isArray(value) ? value : fallback; } catch { return fallback; } }
function persist(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { notify("Não foi possível salvar neste navegador."); } }
function product() { return form.elements.product?.value || products[0]?.id || "potinho"; }
function selected(group) { return [...form.querySelectorAll(`[name="${group}"]:checked`)].map((input) => input.value); }
function isUnavailable(item) { return unavailable.includes(item); }

function makeOptions(root, values, name) {
  root.replaceChildren(...values.map((value) => {
    const label = document.createElement("label"); label.className = "option-row";
    const text = document.createElement("span"); text.textContent = value;
    const input = document.createElement("input"); input.type = "checkbox"; input.name = name; input.value = value;
    const check = document.createElement("span"); check.className = "checkmark";
    label.append(text, input, check);
    input.addEventListener("change", () => enforceLimit(name));
    return label;
  }));
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
  const selectedProduct = products.find((item) => item.id === current) || products[0];
  flavorPanel.hidden = !selectedProduct?.flavors?.length;
  if (selectedProduct?.flavors?.length) {
    const flavorChoices = flavorPanel.querySelector(".choice-row");
    flavorChoices.replaceChildren(...selectedProduct.flavors.map((flavor, index) => {
      const label = document.createElement("label"); label.className = "choice";
      const input = document.createElement("input"); input.type = "radio"; input.name = "flavor"; input.value = flavor; input.checked = index === 0;
      const check = document.createElement("span"); check.className = "checkmark";
      label.append(input, check, document.createTextNode(flavor)); return label;
    }));
  }
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
    const detail = document.createElement("span"); detail.className = "product-limit"; detail.textContent = `${item.toppingLimit} complemento(s) · ${item.sauceLimit} calda(s)`;
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
  persist(STOCK_KEY, unavailable); renderStock(); enforceLimit("topping"); enforceLimit("sauce");
}

function renderStock() {
  [["#topping-stock", toppings], ["#sauce-stock", sauces]].forEach(([selector, items]) => {
    const root = document.querySelector(selector);
    root.replaceChildren(...items.map((item) => {
      const wrap = document.createElement("span"); wrap.className = "stock-item-wrap";
      const button = document.createElement("button"); button.type = "button";
      button.className = `stock-chip${isUnavailable(item) ? " unavailable" : ""}`;
      button.textContent = item; button.setAttribute("aria-pressed", String(isUnavailable(item)));
      button.setAttribute("aria-label", `${item}: ${isUnavailable(item) ? "indisponível, toque para liberar" : "disponível, toque para riscar"}`);
      button.addEventListener("click", () => toggleUnavailable(item)); wrap.append(button);
      if (!(selector === "#topping-stock" ? DEFAULT_TOPPINGS : DEFAULT_SAUCES).includes(item)) {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-option"; remove.textContent = "×";
        remove.setAttribute("aria-label", `Excluir ${item}`); remove.addEventListener("click", () => deleteOption(selector === "#topping-stock" ? "topping" : "sauce", item)); wrap.append(remove);
      }
      return wrap;
    }));
  });
  const productRoot = document.querySelector("#product-stock");
  productRoot.replaceChildren(...products.map((item) => {
    const chip = document.createElement("span"); chip.className = "stock-chip product-chip"; chip.textContent = `${item.icon || "🍧"} ${item.name}`;
    if (item.id !== "potinho" && item.id !== "copinho") {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-product"; remove.textContent = "×"; remove.setAttribute("aria-label", `Excluir ${item.name}`);
      remove.addEventListener("click", () => deleteProduct(item.id)); chip.append(remove);
    }
    return chip;
  }));
}

function addOption(kind, value) {
  const list = kind === "topping" ? toppings : sauces;
  if (list.some((entry) => entry.toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR"))) { notify("Essa opção já existe."); return; }
  if (kind === "topping") { toppings = [...toppings, value]; persist(TOPPINGS_KEY, toppings); }
  else { sauces = [...sauces, value]; persist(SAUCES_KEY, sauces); }
  renderStock(); makeOptions(document.querySelector(kind === "topping" ? "#topping-options" : "#sauce-options"), listFor(kind), kind);
  enforceLimit(kind); notify("Opção adicionada!");
}
function listFor(kind) { return kind === "topping" ? toppings : sauces; }
function deleteOption(kind, value) {
  if (kind === "topping") { toppings = toppings.filter((item) => item !== value); persist(TOPPINGS_KEY, toppings); }
  else { sauces = sauces.filter((item) => item !== value); persist(SAUCES_KEY, sauces); }
  unavailable = unavailable.filter((item) => item !== value); persist(STOCK_KEY, unavailable);
  renderStock(); makeOptions(document.querySelector(kind === "topping" ? "#topping-options" : "#sauce-options"), listFor(kind), kind); enforceLimit(kind);
}
function deleteProduct(id) {
  products = products.filter((item) => item.id !== id); persist(PRODUCTS_KEY, products);
  renderProducts(); updateProduct(); renderStock();
}
function addProduct(name, icon) {
  if (products.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) { notify("Esse produto já existe."); return; }
  const id = `produto-${Date.now()}`;
  products = [...products, { id, name, icon, toppingLimit: 3, sauceLimit: 2 }]; persist(PRODUCTS_KEY, products);
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
  const remove = document.createElement("button"); remove.className = "remove-order"; remove.type = "button"; remove.textContent = "×";
  remove.setAttribute("aria-label", `Excluir pedido de ${order.name}`);
  remove.addEventListener("click", () => { orders = orders.filter((item) => item.id !== order.id); persist(STORAGE_KEY, orders); renderOrders(); });
  top.append(info, remove);
  const productTag = document.createElement("span"); productTag.className = "order-product";
  productTag.textContent = `${order.productIcon || "🍧"} ${order.productName || order.product}${order.flavor ? ` · ${order.flavor}` : ""}`;
  const detail = document.createElement("p"); detail.className = "order-detail";
  detail.textContent = `Complementos: ${order.toppings.join(", ") || "nenhum"} · Caldas: ${order.sauces.join(", ") || "nenhuma"}`;
  card.append(top, productTag, detail);
  if (order.note) { const note = document.createElement("p"); note.className = "order-note"; note.textContent = `Obs.: ${order.note}`; card.append(note); }
  if (!order.done) {
    const done = document.createElement("button"); done.className = "status-button"; done.type = "button"; done.textContent = "✓ Marcar como realizado";
    done.addEventListener("click", () => { orders = orders.map((item) => item.id === order.id ? { ...item, done: true } : item); persist(STORAGE_KEY, orders); renderOrders(); });
    card.append(done);
  } else {
    const undo = document.createElement("button"); undo.className = "status-button"; undo.type = "button"; undo.textContent = "↶ Reabrir pedido";
    undo.addEventListener("click", () => { orders = orders.map((item) => item.id === order.id ? { ...item, done: false } : item); persist(STORAGE_KEY, orders); renderOrders(); });
    card.append(undo);
  }
  return card;
}

function renderOrders() {
  ordersRoot.replaceChildren(...orders.map(makeOrderCard));
  document.querySelector("#order-count").textContent = String(orders.length);
  document.querySelector("#orders-empty").hidden = orders.length > 0;
  document.querySelector("#clear-orders").hidden = !orders.some((order) => order.done);
}

let authUser = null;
let sellerApproved = false;
let sellerIsOwner = false;
let accessCheckId = 0;

function showAuthStatus(message, error = false) {
  const status = document.querySelector("#seller-auth-status");
  status.textContent = message;
  status.classList.toggle("error", error);
}
function setAuthView({ signedIn = false, approved = false, owner = false } = {}) {
  document.querySelector("#seller-login-form").hidden = signedIn;
  document.querySelector("#seller-logout").hidden = !signedIn;
  document.querySelector("#seller-logout-panel").hidden = !signedIn;
  document.querySelector("#seller-content").hidden = !approved;
  document.querySelector("#seller-approvals").hidden = !owner;
}
async function refreshSellerAccess() {
  const checkId = ++accessCheckId;
  const { data: { session } } = await supabase.auth.getSession();
  if (checkId !== accessCheckId) return;
  authUser = session?.user || null;
  sellerApproved = false; sellerIsOwner = false;
  if (!authUser) {
    setAuthView();
    showAuthStatus("Entre com uma conta aprovada ou solicite seu cadastro.");
    return;
  }
  setAuthView({ signedIn: true });
  showAuthStatus("Conferindo a aprovação da sua conta…");
  const { data, error } = await supabase.from("seller_access")
    .select("role, approved_at").eq("user_id", authUser.id).maybeSingle();
  if (checkId !== accessCheckId) return;
  if (error) {
    showAuthStatus("Não foi possível validar o acesso. As regras do Supabase precisam ser instaladas.", true);
    return;
  }
  if (!data?.approved_at) {
    showAuthStatus("Cadastro recebido. A responsável precisa aprovar seu acesso.");
    return;
  }
  sellerApproved = true; sellerIsOwner = data.role === "owner";
  setAuthView({ signedIn: true, approved: true, owner: sellerIsOwner });
  showAuthStatus(sellerIsOwner ? "Conta administradora conectada." : "Conta aprovada.");
  renderStock(); renderOrders();
  if (sellerIsOwner) await renderSellerApprovals();
}
async function renderSellerApprovals() {
  const root = document.querySelector("#seller-approval-list");
  const { data, error } = await supabase.from("seller_access")
    .select("user_id, email, created_at").eq("role", "seller").is("approved_at", null).order("created_at");
  root.replaceChildren();
  if (error) { root.textContent = "Não foi possível carregar os cadastros pendentes."; return; }
  if (!data?.length) { root.textContent = "Nenhum cadastro aguardando aprovação."; return; }
  data.forEach((seller) => {
    const row = document.createElement("div"); row.className = "seller-approval-row";
    const email = document.createElement("span"); email.textContent = seller.email;
    const approve = document.createElement("button"); approve.type = "button"; approve.textContent = "Aprovar";
    approve.addEventListener("click", async () => {
      approve.disabled = true;
      const { error: updateError } = await supabase.from("seller_access")
        .update({ approved_at: new Date().toISOString() }).eq("user_id", seller.user_id);
      if (updateError) { showAuthStatus("Não foi possível aprovar esse cadastro.", true); approve.disabled = false; return; }
      notify("Vendedora aprovada."); await renderSellerApprovals();
    });
    row.append(email, approve); root.append(row);
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
document.querySelector("#seller-signup").addEventListener("click", async () => {
  const email = document.querySelector("#seller-email").value.trim();
  const password = document.querySelector("#seller-password").value;
  if (!email || password.length < 6) {
    showAuthStatus("Informe o e-mail e uma senha com pelo menos 6 caracteres.", true);
    return;
  }
  showAuthStatus("Enviando solicitação…");
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) { showAuthStatus("Não foi possível solicitar o cadastro. Confira os dados e tente novamente.", true); return; }
  if (data.session) await refreshSellerAccess();
  else showAuthStatus("Solicitação enviada. Confirme seu e-mail; depois, aguarde a aprovação da responsável.");
});
async function sellerLogout() {
  await supabase.auth.signOut();
  authUser = null; sellerApproved = false; sellerIsOwner = false;
  setAuthView(); showAuthStatus("Você saiu da conta.");
}
document.querySelector("#seller-logout").addEventListener("click", sellerLogout);
document.querySelector("#seller-logout-panel").addEventListener("click", sellerLogout);
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
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

form.addEventListener("change", (event) => { if (event.target.name === "product") updateProduct(); });
form.addEventListener("submit", (event) => {
  event.preventDefault(); if (!form.reportValidity()) return;
  const name = document.querySelector("#customer-name").value.trim();
  if (!name) { document.querySelector("#customer-name").focus(); return; }
  const chosenProduct = products.find((item) => item.id === product());
  orders.unshift({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name,
    product: chosenProduct.id, productName: chosenProduct.name, productIcon: chosenProduct.icon, flavor: chosenProduct.flavors?.length ? form.elements.flavor.value : "",
    toppings: selected("topping"), sauces: selected("sauce"), note: document.querySelector("#order-note").value.trim(), createdAt: new Date().toISOString(), done: false });
  persist(STORAGE_KEY, orders); renderOrders(); form.reset(); form.elements.product.value = "potinho"; updateProduct();
  document.querySelector("#customer-name").focus(); notify("Pedido anotado com sucesso!");
});

document.querySelector("#clear-orders").addEventListener("click", () => {
  orders = orders.filter((order) => !order.done); persist(STORAGE_KEY, orders); renderOrders();
});
document.querySelectorAll(".add-option-form").forEach((addForm) => addForm.addEventListener("submit", (event) => {
  event.preventDefault(); const input = addForm.querySelector("input"); const value = input.value.trim();
  if (value) { addOption(addForm.dataset.kind, value); addForm.reset(); }
}));
document.querySelector("#add-product-form").addEventListener("submit", (event) => {
  event.preventDefault(); const name = document.querySelector("#new-product-name").value.trim();
  if (name) { addProduct(name, document.querySelector("#new-product-icon").value); event.currentTarget.reset(); }
});
window.addEventListener("hashchange", renderRoute);
renderProducts();
makeOptions(document.querySelector("#topping-options"), toppings, "topping");
makeOptions(document.querySelector("#sauce-options"), sauces, "sauce");
updateProduct(); renderStock(); renderOrders(); renderRoute();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});

