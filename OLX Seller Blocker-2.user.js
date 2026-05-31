// ==UserScript==
// @name         OLX Seller Blocker
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Блокування продавців на OLX із перемиканням видимості, експортом/імпортом
// @author       You
// @match        https://www.olx.ua/*
// @match        https://olx.ua/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        STORAGE_KEY: 'olx_blocked_sellers',
        HIDE_STATE_KEY: 'olx_hide_blocked_cards',
        BLOCK_BUTTON_TEXT: '🚫 Заблокувати',
        UNBLOCK_BUTTON_TEXT: '✅ Розблокувати',
        BLOCKED_MESSAGE: '⛔ Заблоковано',
        HOVER_HIDE_DELAY_MS: 400,  // ← задержка скрытия панели при уходе курсора (мс)
        DEBUG: false
    };

    class BlockedSellers {
        constructor() {
            this.blocked = this.load();
        }

        load() {
            try {
                const data = localStorage.getItem(CONFIG.STORAGE_KEY);
                return data ? JSON.parse(data) : {};
            } catch (e) {
                console.error('Ошибка загрузки блэклиста:', e);
                return {};
            }
        }

        save() {
            try {
                localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(this.blocked));
            } catch (e) {
                console.error('Ошибка сохранения блэклиста:', e);
            }
        }

        add(sellerId, sellerName) {
            this.blocked[sellerId] = {
                name: sellerName,
                blockedAt: new Date().toISOString()
            };
            this.save();
            log(`✓ Заблокирован: ${sellerName} (ID: ${sellerId})`);
        }

        remove(sellerId) {
            if (this.blocked[sellerId]) {
                const name = this.blocked[sellerId].name;
                delete this.blocked[sellerId];
                this.save();
                log(`✓ Разблокирован: ${name} (ID: ${sellerId})`);
            }
        }

        isBlocked(sellerId) {
            return !!this.blocked[sellerId];
        }

        getCount() {
            return Object.keys(this.blocked).length;
        }

        list() {
            return Object.entries(this.blocked).map(([id, data]) => ({
                id: parseInt(id),
                ...data
            }));
        }

        exportJSON() {
            return JSON.stringify(this.blocked, null, 2);
        }

        importJSON(jsonStr) {
            const data = JSON.parse(jsonStr);
            let imported = 0, skipped = 0;
            Object.entries(data).forEach(([id, info]) => {
                if (!this.blocked[id]) {
                    this.blocked[id] = info;
                    imported++;
                } else {
                    skipped++;
                }
            });
            this.save();
            return { imported, skipped };
        }
    }

    class OLXDataParser {
        constructor() {
            this.adToSeller = new Map();
            this.cacheKey = 'olx_ad_seller_cache';
            this.loadCache();
            this.parse();
        }

        loadCache() {
            try {
                const cached = localStorage.getItem(this.cacheKey);
                if (cached) {
                    const data = JSON.parse(cached);
                    Object.entries(data).forEach(([adId, seller]) => {
                        this.adToSeller.set(adId, seller);
                    });
                    log(`✓ Загружен кеш: ${this.adToSeller.size} записей`);
                }
            } catch (e) {
                log('⚠ Ошибка загрузки кеша: ' + e.message);
            }
        }

        saveCache() {
            try {
                const data = {};
                this.adToSeller.forEach((seller, adId) => {
                    data[adId] = seller;
                });
                localStorage.setItem(this.cacheKey, JSON.stringify(data));
                log(`✓ Кеш сохранён: ${this.adToSeller.size} записей`);
            } catch (e) {
                log('⚠ Ошибка сохранения кеша: ' + e.message);
            }
        }

        addToCache(adId, seller) {
            this.adToSeller.set(String(adId), seller);
            this.saveCache();
        }

        parse() {
            try {
                const scripts = document.querySelectorAll('script');
                let data = null;

                for (const script of scripts) {
                    const content = script.textContent;
                    if (content.includes('window.__PRERENDERED_STATE__')) {
                        try {
                            let match = content.match(/window\.__PRERENDERED_STATE__\s*=\s*"((?:[^"\\]|\\.)*)";/s);
                            if (!match) {
                                match = content.match(/window\.__PRERENDERED_STATE__\s*=\s*"(.+?)"\s*;/s);
                            }
                            if (match) {
                                let jsonStr = match[1];
                                try {
                                    jsonStr = JSON.parse('"' + jsonStr + '"');
                                } catch (e) {
                                    jsonStr = jsonStr.replace(/\\"/g, '"');
                                }
                                data = JSON.parse(jsonStr);
                                break;
                            }
                        } catch (e) {
                            continue;
                        }
                    }
                }

                if (!data) return;

                const ads = data?.listing?.listing?.ads || [];
                let newEntries = 0;

                ads.forEach(ad => {
                    const adId = String(ad.id);
                    const seller = ad.user || {};
                    if (seller.id) {
                        const sellerData = { id: seller.id, name: seller.name || 'Без імені', uuid: seller.uuid };
                        if (!this.adToSeller.has(adId)) newEntries++;
                        this.adToSeller.set(adId, sellerData);
                    }
                });

                if (newEntries > 0) this.saveCache();

            } catch (e) {
                console.error('Ошибка парсинга __PRERENDERED_STATE__:', e);
            }
        }

        getSellerByAdId(adId) {
            return this.adToSeller.get(String(adId));
        }
    }

    class UIManager {
        constructor(blockedSellers, dataParser) {
            this.blockedSellers = blockedSellers;
            this.dataParser = dataParser;
            this.addStyles();
        }

        addStyles() {
            const style = document.createElement('style');
            style.textContent = `
                [data-olx-blocker-ad] {
                    display: inline-block !important;
                    margin-left: 0px !important;
                    margin-top: 10px !important;
                    vertical-align: middle !important;
                    z-index: 100 !important;
                }
                .olx-block-btn {
                    display: inline-block !important;
                    padding: 3px 10px !important;
                    font-size: 11px !important;
                    font-weight: 500 !important;
                    color: #808080 !important;
                    background: transparent !important;
                    border: 1px solid #ccc !important;
                    border-radius: 4px !important;
                    cursor: pointer !important;
                    text-decoration: none !important;
                    transition: all 0.2s !important;
                    white-space: nowrap !important;
                    max-width: 200px !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                }
                .olx-block-btn:hover {
                    background: #ff6b6b !important;
                    color: white !important;
                    max-width: none !important;
                }
                .olx-block-btn.blocked {
                    border-color: #51cf66 !important;
                    color: #51cf66 !important;
                }
                .olx-block-btn.blocked:hover {
                    background: #51cf66 !important;
                    color: white !important;
                }
                .olx-blocked-card {
                    opacity: 0.4 !important;
                    position: relative !important;
                }
                .olx-blocked-card::after {
                    opacity: 0.4 !important;
                    content: '${CONFIG.BLOCKED_MESSAGE}' !important;
                    position: absolute !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    background: rgba(0,0,0,0.9) !important;
                    color: white !important;
                    padding: 10px 20px !important;
                    border-radius: 8px !important;
                    font-weight: bold !important;
                    font-size: 16px !important;
                    z-index: 10 !important;
                }
                body.olx-hide-blocked .olx-blocked-card {
                    display: none !important;
                }

                /* --- Floating widget --- */
                #olx-blocker-widget {
                    position: fixed !important;
                    bottom: 20px !important;
                    left: 20px !important;
                    z-index: 9999 !important;
                    font-family: sans-serif !important;
                    font-size: 12px !important;
                }
                #olx-blocker-icon {
                    width: 40px !important;
                    height: 40px !important;
                    background: #002f34 !important;
                    border-radius: 50% !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    cursor: pointer !important;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4) !important;
                    font-size: 18px !important;
                    transition: transform 0.2s !important;
                    user-select: none !important;
                }
                #olx-blocker-icon:hover {
                    transform: scale(1.1) !important;
                }
                #olx-blocker-badge {
                    position: absolute !important;
                    top: -4px !important;
                    right: -4px !important;
                    background: #ff6b6b !important;
                    color: white !important;
                    border-radius: 10px !important;
                    min-width: 18px !important;
                    height: 18px !important;
                    font-size: 10px !important;
                    font-weight: bold !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 0 4px !important;
                    box-sizing: border-box !important;
                }
                /* Невидимый мост между иконкой и панелью — заполняет зазор */
                #olx-blocker-widget::after {
                    content: '' !important;
                    position: absolute !important;
                    bottom: 40px !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 12px !important;
                    background: transparent !important;
                }
                #olx-blocker-panel {
                    position: absolute !important;
                    bottom: 52px !important;
                    left: 0 !important;
                    background: #002f34 !important;
                    color: white !important;
                    padding: 14px !important;
                    border-radius: 10px !important;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.4) !important;
                    width: 180px !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    transform: translateY(6px) !important;
                    transition: opacity 0.2s, transform 0.2s !important;
                }
                #olx-blocker-panel.visible,
                #olx-blocker-panel.pinned {
                    opacity: 1 !important;
                    pointer-events: all !important;
                    transform: translateY(0) !important;
                }
                #olx-blocker-panel h4 {
                    margin: 0 0 10px 0 !important;
                    font-size: 13px !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 6px !important;
                }
                #olx-stats-content {
                    margin-bottom: 10px !important;
                    line-height: 1.6 !important;
                    color: #aed6db !important;
                }
                .olx-panel-btn {
                    display: block !important;
                    width: 100% !important;
                    margin-top: 6px !important;
                    padding: 6px 10px !important;
                    border: none !important;
                    border-radius: 5px !important;
                    cursor: pointer !important;
                    font-size: 11px !important;
                    font-weight: 600 !important;
                    text-align: center !important;
                    box-sizing: border-box !important;
                    transition: filter 0.15s !important;
                }
                .olx-panel-btn:hover { filter: brightness(1.15) !important; }
                .olx-panel-btn.btn-toggle  { background: #4c6ef5 !important; color: white !important; }
                .olx-panel-btn.btn-manage  { background: #ff6b6b !important; color: white !important; }
                .olx-panel-btn.btn-export  { background: #51cf66 !important; color: white !important; }
                .olx-panel-btn.btn-import  { background: #ffd43b !important; color: #333 !important; }
                .olx-panel-btn.btn-cache   { background: #868e96 !important; color: white !important; }

                #olx-import-input { display: none !important; }
            `;
            document.head.appendChild(style);
            this.loadHideState();
        }

        loadHideState() {
            try {
                if (localStorage.getItem(CONFIG.HIDE_STATE_KEY) === 'true') {
                    document.body.classList.add('olx-hide-blocked');
                }
            } catch (e) {}
        }

        toggleHideBlocked() {
            document.body.classList.toggle('olx-hide-blocked');
            const isHidden = document.body.classList.contains('olx-hide-blocked');
            try {
                localStorage.setItem(CONFIG.HIDE_STATE_KEY, isHidden.toString());
            } catch (e) {}
            this.updateStatsPanel();
        }

        addBlockButton(card) {
            const locationElement = card.querySelector('[data-testid="location-date"]');
            if (!locationElement) return;

            const adId = card.id;
            if (!adId) return;

            const parentDiv = locationElement.parentElement;
            if (parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`)) return;

            let seller = this.dataParser.getSellerByAdId(adId);

            if (!seller || !seller.id) {
                const link = card.querySelector('a[href*="/d/uk/obyavlenie/"]');
                if (link) {
                    this.addBlockButtonWithAjax(card, adId, link.getAttribute('href'), locationElement);
                }
                return;
            }

            const isBlocked = this.blockedSellers.isBlocked(seller.id);

            const btnContainer = document.createElement('span');
            btnContainer.style.marginLeft = '10px';
            btnContainer.style.display = 'inline-block';
            btnContainer.setAttribute('data-olx-blocker-ad', adId);
            btnContainer.setAttribute('data-olx-blocker-seller', seller.id);
            btnContainer.setAttribute('data-olx-blocker-seller-name', seller.name);

            const btn = document.createElement('a');
            btn.className = 'olx-block-btn' + (isBlocked ? ' blocked' : '');
            btn.textContent = isBlocked
                ? `${CONFIG.UNBLOCK_BUTTON_TEXT}: ${seller.name}`
                : `${CONFIG.BLOCK_BUTTON_TEXT}: ${seller.name}`;
            btn.href = '#';
            btn.title = `${seller.name} (ID: ${seller.id})`;

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleBlock(adId, seller, btn);
            });

            btnContainer.appendChild(btn);
            locationElement.parentNode.insertBefore(btnContainer, locationElement.nextSibling);

            if (isBlocked) this.hideCard(card);
        }

        addBlockButtonWithAjax(card, adId, adUrl, locationElement) {
            const parentDiv = locationElement.parentElement;
            if (parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`)) return;

            const btnContainer = document.createElement('span');
            btnContainer.style.marginLeft = '10px';
            btnContainer.style.display = 'inline-block';
            btnContainer.setAttribute('data-olx-blocker-ad', adId);

            const btn = document.createElement('a');
            btn.className = 'olx-block-btn';
            btn.textContent = '⏳...';
            btn.href = '#';
            btn.style.cursor = 'wait';

            btnContainer.appendChild(btn);
            locationElement.parentNode.insertBefore(btnContainer, locationElement.nextSibling);

            fetch(adUrl, { method: 'GET', cache: 'no-store' })
                .then(r => r.text())
                .then(html => {
                    let match = html.match(/"user":\s*\{\s*"id"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"([^"]+)"/)
                        || html.match(/\\"user\\":\s*\{\s*\\"id\\":\s*(\d+)\s*,\s*\\"name\\":\s*\\"([^"]+)\\"/)
                        || html.match(/"user":\s*\{\s*"id"\s*:\s*(\d+)[^}]*"name"\s*:\s*"([^"]*?)"/);

                    if (!match) {
                        const idM = html.match(/"userId"\s*:\s*(\d+)|"user_id"\s*:\s*(\d+)|"sellerId"\s*:\s*(\d+)/);
                        if (idM) {
                            const userId = idM[1] || idM[2] || idM[3];
                            const nameM = html.match(/"sellerName"\s*:\s*"([^"]+)"|"userName"\s*:\s*"([^"]+)"/);
                            if (nameM) match = [null, userId, nameM[1] || nameM[2]];
                        }
                    }

                    if (match) {
                        const seller = {
                            id: parseInt(match[1]),
                            name: match[2].replace(/\\u[\da-f]{4}/gi, m => String.fromCharCode(parseInt(m.slice(2), 16)))
                        };

                        this.dataParser.addToCache(adId, seller);
                        btnContainer.setAttribute('data-olx-blocker-seller', seller.id);
                        btnContainer.setAttribute('data-olx-blocker-seller-name', seller.name);

                        const isBlocked = this.blockedSellers.isBlocked(seller.id);
                        btn.className = 'olx-block-btn' + (isBlocked ? ' blocked' : '');
                        btn.textContent = isBlocked
                            ? `${CONFIG.UNBLOCK_BUTTON_TEXT}: ${seller.name}`
                            : `${CONFIG.BLOCK_BUTTON_TEXT}: ${seller.name}`;
                        btn.title = `${seller.name} (ID: ${seller.id})`;
                        btn.style.cursor = 'pointer';
                        btn.onclick = null;
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.toggleBlock(adId, seller, btn);
                        });

                        if (isBlocked) this.hideCard(card);
                    } else {
                        btn.textContent = '❌ Помилка';
                        btn.style.cursor = 'not-allowed';
                    }
                })
                .catch(() => {
                    btn.textContent = '❌ Помилка';
                    btn.style.cursor = 'not-allowed';
                });
        }

        toggleBlock(adId, seller, btn) {
            const isBlocked = this.blockedSellers.isBlocked(seller.id);
            if (isBlocked) {
                this.blockedSellers.remove(seller.id);
                this.updateAllSellerButtons(seller.id, false);
                this.showAllCardsFromSeller(seller.id);
            } else {
                if (confirm(`Заблокувати всі оголошення від "${seller.name}"?`)) {
                    this.blockedSellers.add(seller.id, seller.name);
                    this.updateAllSellerButtons(seller.id, true);
                    this.hideAllCardsFromSeller(seller.id);
                }
            }
            this.updateStatsPanel();
        }

        updateAllSellerButtons(sellerId, isBlocked) {
            document.querySelectorAll(`[data-olx-blocker-seller="${sellerId}"]`).forEach(container => {
                const btn = container.querySelector('.olx-block-btn');
                const sellerName = container.getAttribute('data-olx-blocker-seller-name') || 'Автор';
                if (btn) {
                    btn.className = 'olx-block-btn' + (isBlocked ? ' blocked' : '');
                    btn.textContent = isBlocked
                        ? `${CONFIG.UNBLOCK_BUTTON_TEXT}: ${sellerName}`
                        : `${CONFIG.BLOCK_BUTTON_TEXT}: ${sellerName}`;
                }
            });
        }

        hideCard(card) { card.classList.add('olx-blocked-card'); }
        showCard(card) { card.classList.remove('olx-blocked-card'); }

        hideAllCardsFromSeller(sellerId) {
            document.querySelectorAll('[data-cy="l-card"]').forEach(card => {
                const seller = this.dataParser.getSellerByAdId(card.id);
                if (seller && seller.id === sellerId) this.hideCard(card);
            });
        }

        showAllCardsFromSeller(sellerId) {
            document.querySelectorAll('[data-cy="l-card"]').forEach(card => {
                const seller = this.dataParser.getSellerByAdId(card.id);
                if (seller && seller.id === sellerId) this.showCard(card);
            });
        }

        processAllCards() {
            document.querySelectorAll('[data-cy="l-card"]').forEach(card => this.addBlockButton(card));
        }

        // ---- Floating widget ----

        createStatsPanel() {
            const widget = document.createElement('div');
            widget.id = 'olx-blocker-widget';

            const isHidden = document.body.classList.contains('olx-hide-blocked');

            widget.innerHTML = `
                <div id="olx-blocker-panel">
                    <h4>🚫 OLX Blocker</h4>
                    <div id="olx-stats-content"></div>
                    <button class="olx-panel-btn btn-toggle" id="olx-toggle-btn"></button>
                    <button class="olx-panel-btn btn-manage" id="olx-manage-btn">📋 Керувати списком</button>
                    <button class="olx-panel-btn btn-export" id="olx-export-btn">⬇️ Експорт JSON</button>
                    <button class="olx-panel-btn btn-import" id="olx-import-btn">⬆️ Імпорт JSON</button>
                    <button class="olx-panel-btn btn-cache"  id="olx-cache-btn">🗑️ Очистити кеш</button>
                    <input type="file" id="olx-import-input" accept=".json">
                </div>
                <div id="olx-blocker-icon">
                    🚫
                    <span id="olx-blocker-badge">0</span>
                </div>
            `;

            document.body.appendChild(widget);

            // Hover с задержкой скрытия
            const panel = document.getElementById('olx-blocker-panel');
            const icon  = document.getElementById('olx-blocker-icon');
            let hideTimer = null;

            function showPanel() {
                clearTimeout(hideTimer);
                panel.classList.add('visible');
            }
            function scheduleHide() {
                if (panel.classList.contains('pinned')) return;
                hideTimer = setTimeout(() => {
                    panel.classList.remove('visible');
                }, CONFIG.HOVER_HIDE_DELAY_MS);
            }

            widget.addEventListener('mouseenter', showPanel);
            widget.addEventListener('mouseleave', scheduleHide);

            // Pin panel on icon click (for touch/mobile)
            icon.addEventListener('click', () => {
                panel.classList.toggle('pinned');
                if (panel.classList.contains('pinned')) {
                    panel.classList.add('visible');
                } else {
                    scheduleHide();
                }
            });

            document.getElementById('olx-toggle-btn').addEventListener('click', () => this.toggleHideBlocked());
            document.getElementById('olx-manage-btn').addEventListener('click', () => this.showManageDialog());

            document.getElementById('olx-export-btn').addEventListener('click', () => {
                const json = this.blockedSellers.exportJSON();
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `olx_blocked_${new Date().toISOString().slice(0,10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            document.getElementById('olx-import-btn').addEventListener('click', () => {
                document.getElementById('olx-import-input').click();
            });

            document.getElementById('olx-import-input').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const result = this.blockedSellers.importJSON(ev.target.result);
                        alert(`Імпорт завершено!\nДодано: ${result.imported}\nПропущено (вже є): ${result.skipped}`);
                        this.updateStatsPanel();
                        this.processAllCards();
                    } catch (err) {
                        alert('Помилка імпорту: ' + err.message);
                    }
                };
                reader.readAsText(file);
                e.target.value = '';
            });

            document.getElementById('olx-cache-btn').addEventListener('click', () => {
                if (confirm('Очистити кеш маппінгу оголошень? Список заблокованих збережеться.')) {
                    localStorage.removeItem(this.dataParser.cacheKey);
                    this.dataParser.adToSeller.clear();
                    this.updateStatsPanel();
                    alert('Кеш очищено!');
                }
            });

            this.updateStatsPanel();
        }

        updateStatsPanel() {
            const count = this.blockedSellers.getCount();

            const badge = document.getElementById('olx-blocker-badge');
            if (badge) badge.textContent = count;

            const content = document.getElementById('olx-stats-content');
            if (content) {
                content.innerHTML = `Заблоковано: <b>${count}</b><br>Кеш: ${this.dataParser.adToSeller.size} записів`;
            }

            const toggleBtn = document.getElementById('olx-toggle-btn');
            if (toggleBtn) {
                const isHidden = document.body.classList.contains('olx-hide-blocked');
                toggleBtn.textContent = isHidden ? '👁️ Показати заблокованих' : '🙈 Сховати заблокованих';
            }
        }

        showManageDialog() {
            const blocked = this.blockedSellers.list();
            if (blocked.length === 0) {
                alert('Список заблокованих продавців порожній');
                return;
            }
            let message = 'ЗАБЛОКОВАНІ ПРОДАВЦІ:\n\n';
            blocked.forEach((seller, index) => {
                message += `${index + 1}. ${seller.name} (ID: ${seller.id})\n`;
                message += `   Заблоковано: ${new Date(seller.blockedAt).toLocaleString('uk-UA')}\n\n`;
            });
            message += 'Для розблокування натисніть кнопку на картці оголошення';
            alert(message);
        }
    }

    function log(message) {
        if (CONFIG.DEBUG) console.log(`[OLX Blocker] ${message}`);
    }

    function init() {
        const blockedSellers = new BlockedSellers();
        const dataParser = new OLXDataParser();
        const uiManager = new UIManager(blockedSellers, dataParser);

        let processAttempts = 0;
        const maxAttempts = 10;

        function tryProcessCards() {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            if (cards.length > 0) {
                uiManager.processAllCards();
                return true;
            } else {
                processAttempts++;
                if (processAttempts < maxAttempts) setTimeout(tryProcessCards, 500);
                return false;
            }
        }

        if (!tryProcessCards()) setTimeout(tryProcessCards, 500);
        setTimeout(() => uiManager.createStatsPanel(), 1000);

        let isProcessing = false;
        const observer = new MutationObserver((mutations) => {
            if (isProcessing) return;
            let hasNewCards = false;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.hasAttribute?.('data-olx-blocker-ad')) return;
                    if (node.getAttribute?.('data-cy') === 'l-card') hasNewCards = true;
                    if (node.querySelectorAll?.('[data-cy="l-card"]').length > 0) hasNewCards = true;
                });
            });

            if (hasNewCards) {
                isProcessing = true;
                setTimeout(() => {
                    uiManager.processAllCards();
                    isProcessing = false;
                }, 100);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setInterval(() => {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            let missingButtons = 0;

            cards.forEach(card => {
                const adId = card.id;
                if (!adId) return;
                const locationElement = card.querySelector('[data-testid="location-date"]');
                if (!locationElement) return;
                const parentDiv = locationElement.parentElement;
                if (!(parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`))) {
                    missingButtons++;
                } else {
                    const seller = dataParser.getSellerByAdId(adId);
                    if (seller && blockedSellers.isBlocked(seller.id) && !card.classList.contains('olx-blocked-card')) {
                        uiManager.hideCard(card);
                    }
                }
            });

            if (missingButtons > 0) uiManager.processAllCards();
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }

})();
