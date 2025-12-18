// ==UserScript==
// @name         OLX Seller Blocker
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Блокировка продавцов на OLX с переключением видимости
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
                                log('Длина извлечённой строки: ' + jsonStr.length);

                                try {
                                    jsonStr = JSON.parse('"' + jsonStr + '"');
                                } catch (e) {
                                    log('⚠ Ошибка при декодировании escape-последовательностей: ' + e.message);
                                    jsonStr = jsonStr.replace(/\\"/g, '"');
                                }

                                data = JSON.parse(jsonStr);
                                log('✓ JSON успешно распарсен');
                                break;
                            }
                        } catch (e) {
                            log('⚠ Ошибка при декодировании JSON из скрипта: ' + e.message);
                            continue;
                        }
                    }
                }

                if (!data) {
                    log('⚠ __PRERENDERED_STATE__ не найден или не удалось распарсить');
                    log('⚠ Будет использован кеш и fallback методы');
                    return;
                }

                const ads = data?.listing?.listing?.ads || [];
                log(`✓ Найдено ${ads.length} объявлений в __PRERENDERED_STATE__`);

                let newEntries = 0;

                ads.forEach(ad => {
                    const adId = String(ad.id);
                    const seller = ad.user || {};

                    if (seller.id) {
                        const sellerData = {
                            id: seller.id,
                            name: seller.name || 'Без імені',
                            uuid: seller.uuid
                        };

                        if (!this.adToSeller.has(adId)) {
                            newEntries++;
                        }

                        this.adToSeller.set(adId, sellerData);
                    }
                });

                if (newEntries > 0) {
                    log(`✓ Добавлено ${newEntries} новых записей в кеш`);
                    this.saveCache();
                }

                log(`✓ Всего в кеше: ${this.adToSeller.size} записей`);

            } catch (e) {
                console.error('Ошибка парсинга __PRERENDERED_STATE__:', e);
                log('⚠ Будет использован кеш и fallback методы');
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
                    background: rgba(0, 0, 0, 0.9) !important;
                    color: white !important;
                    padding: 10px 20px !important;
                    border-radius: 8px !important;
                    font-weight: bold !important;
                    font-size: 16px !important;
                    z-index: 10 !important;
                }

                /* Скрытие заблокированных карточек */
                body.olx-hide-blocked .olx-blocked-card {
                    display: none !important;
                }

                .olx-stats-panel {
                    position: fixed !important;
                    bottom: 20px !important;
                    left: 20px !important;
                    background: #002f34 !important;
                    color: white !important;
                    padding: 15px !important;
                    border-radius: 8px !important;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
                    font-size: 12px !important;
                    z-index: 9999 !important;
                    max-width: 160px !important;
                }
                .olx-stats-panel h4 {
                    margin: 0 0 10px 0 !important;
                    font-size: 14px !important;
                }
                .olx-stats-panel button {
                    margin-top: 5px !important;
                    padding: 5px 10px !important;
                    background: #ff6b6b !important;
                    color: white !important;
                    border: none !important;
                    border-radius: 4px !important;
                    cursor: pointer !important;
                    width: 100% !important;
                }
                .olx-stats-panel button:hover {
                    background: #ff5252 !important;
                }
                .olx-stats-panel button.toggle-btn {
                    background: #4c6ef5 !important;
                }
                .olx-stats-panel button.toggle-btn:hover {
                    background: #3b5bdb !important;
                }
                .olx-stats-panel button.cache-btn {
                    background: #868e96 !important;
                }
                .olx-stats-panel button.cache-btn:hover {
                    background: #6c757d !important;
                }
            `;
            document.head.appendChild(style);

            // Применяем сохранённое состояние
            this.loadHideState();
        }

        loadHideState() {
            try {
                const hideBlocked = localStorage.getItem(CONFIG.HIDE_STATE_KEY) === 'true';
                if (hideBlocked) {
                    document.body.classList.add('olx-hide-blocked');
                }
            } catch (e) {
                log('⚠ Ошибка загрузки состояния: ' + e.message);
            }
        }

        toggleHideBlocked() {
            document.body.classList.toggle('olx-hide-blocked');
            const isHidden = document.body.classList.contains('olx-hide-blocked');

            try {
                localStorage.setItem(CONFIG.HIDE_STATE_KEY, isHidden.toString());
                log(`✓ Заблокированные карточки ${isHidden ? 'скрыты' : 'показаны'}`);
            } catch (e) {
                log('⚠ Ошибка сохранения состояния: ' + e.message);
            }

            this.updateStatsPanel();
        }

        addBlockButton(card) {
            const locationElement = card.querySelector('[data-testid="location-date"]');
            if (!locationElement) {
                log(`⚠ Не найден location-date для карточки ${card.id}`);
                return;
            }

            const adId = card.id;
            if (!adId) {
                log(`⚠ У карточки нет ID`);
                return;
            }

            const parentDiv = locationElement.parentElement;
            if (parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`)) {
                return;
            }

            let seller = this.dataParser.getSellerByAdId(adId);

            if (!seller || !seller.id) {
                log(`⚠ Не удалось найти продавца в __PRERENDERED_STATE__ для ${adId}, попытка через AJAX...`);

                const link = card.querySelector('a[href*="/d/uk/obyavlenie/"]');
                if (link) {
                    const adUrl = link.getAttribute('href');
                    this.addBlockButtonWithAjax(card, adId, adUrl, locationElement);
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

            log(`✓ Добавлена кнопка для ${adId} (${seller.name})${isBlocked ? ' [ЗАБЛОКИРОВАН]' : ''}`);

            if (isBlocked) {
                this.hideCard(card);
            }
        }

        addBlockButtonWithAjax(card, adId, adUrl, locationElement) {
            const parentDiv = locationElement.parentElement;
            if (parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`)) {
                return;
            }

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

            fetch(adUrl, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                },
                cache: 'no-store'
            })
                .then(response => {
                    log(`AJAX ответ для ${adId}: статус ${response.status}`);
                    return response.text();
                })
                .then(html => {
                    log(`AJAX HTML для ${adId}: размер ${html.length} байт`);

                    let match = html.match(/"user":\s*\{\s*"id"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"([^"]+)"/);

                    if (!match) {
                        log(`Попытка 2: альтернативный формат с экранированием`);
                        match = html.match(/\\"user\\":\s*\{\s*\\"id\\":\s*(\d+)\s*,\s*\\"name\\":\s*\\"([^"]+)\\"/);
                    }

                    if (!match) {
                        log(`Попытка 3: поиск в __PRERENDERED_STATE__`);
                        const stateMatch = html.match(/"user":\s*\{\s*"id"\s*:\s*(\d+)[^}]*"name"\s*:\s*"([^"]*?)"/);
                        if (stateMatch) {
                            match = stateMatch;
                        }
                    }

                    if (!match) {
                        log(`Попытка 4: упрощённый поиск только ID`);
                        const idMatch = html.match(/"userId"\s*:\s*(\d+)|"user_id"\s*:\s*(\d+)|"sellerId"\s*:\s*(\d+)/);
                        if (idMatch) {
                            const userId = idMatch[1] || idMatch[2] || idMatch[3];
                            log(`Найден userId: ${userId}`);
                            const nameMatch = html.match(/"sellerName"\s*:\s*"([^"]+)"|"userName"\s*:\s*"([^"]+)"/);
                            if (nameMatch) {
                                match = [null, userId, nameMatch[1] || nameMatch[2]];
                            }
                        }
                    }

                    if (match) {
                        const seller = {
                            id: parseInt(match[1]),
                            name: match[2].replace(/\\u[\da-f]{4}/gi, (m) =>
                                String.fromCharCode(parseInt(m.slice(2), 16))
                            )
                        };

                        log(`✓ Получен seller через AJAX: ${seller.name} (${seller.id})`);

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

                        if (isBlocked) {
                            this.hideCard(card);
                        }
                    } else {
                        log(`✗ Не удалось найти seller в HTML для ${adId}`);
                        btn.textContent = '❌ Помилка';
                        btn.style.cursor = 'not-allowed';
                    }
                })
                .catch(error => {
                    log(`✗ Ошибка AJAX для ${adId}: ${error}`);
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
            const sellerButtons = document.querySelectorAll(`[data-olx-blocker-seller="${sellerId}"]`);

            log(`🔄 Обновление ${sellerButtons.length} кнопок для продавца ${sellerId}`);

            sellerButtons.forEach(container => {
                const btn = container.querySelector('.olx-block-btn');
                const sellerName = container.getAttribute('data-olx-blocker-seller-name') || 'Автор';

                if (btn) {
                    if (isBlocked) {
                        btn.className = 'olx-block-btn blocked';
                        btn.textContent = `${CONFIG.UNBLOCK_BUTTON_TEXT}: ${sellerName}`;
                    } else {
                        btn.className = 'olx-block-btn';
                        btn.textContent = `${CONFIG.BLOCK_BUTTON_TEXT}: ${sellerName}`;
                    }
                }
            });
        }

        hideCard(card) {
            card.classList.add('olx-blocked-card');
        }

        showCard(card) {
            card.classList.remove('olx-blocked-card');
        }

        hideAllCardsFromSeller(sellerId) {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            cards.forEach(card => {
                const adId = card.id;
                const seller = this.dataParser.getSellerByAdId(adId);
                if (seller && seller.id === sellerId) {
                    this.hideCard(card);
                }
            });
        }

        showAllCardsFromSeller(sellerId) {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            cards.forEach(card => {
                const adId = card.id;
                const seller = this.dataParser.getSellerByAdId(adId);
                if (seller && seller.id === sellerId) {
                    this.showCard(card);
                }
            });
        }

        processAllCards() {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            log(`Обработка ${cards.length} карточек объявлений`);

            cards.forEach(card => {
                this.addBlockButton(card);
            });
        }

        createStatsPanel() {
            const panel = document.createElement('div');
            panel.className = 'olx-stats-panel';

            const isHidden = document.body.classList.contains('olx-hide-blocked');
            const toggleText = isHidden ? '👁️ Показати' : '🚫 Сховати';

            panel.innerHTML = `
                <h4>🚫 OLX Blocker</h4>
                <div id="olx-stats-content">
                    Заблоковано: ${this.blockedSellers.getCount()}<br>
                    Кеш: ${this.dataParser.adToSeller.size} записів
                </div>
                <button id="olx-toggle-visibility-btn" class="toggle-btn">${toggleText} заблокованих</button>
                <button id="olx-manage-btn">Керувати списком</button>
                <button id="olx-clear-cache-btn" class="cache-btn">Очистити кеш</button>
            `;
            document.body.appendChild(panel);

            document.getElementById('olx-toggle-visibility-btn').addEventListener('click', () => {
                this.toggleHideBlocked();
            });

            document.getElementById('olx-manage-btn').addEventListener('click', () => {
                this.showManageDialog();
            });

            document.getElementById('olx-clear-cache-btn').addEventListener('click', () => {
                if (confirm('Очистити кеш маппінгу оголошень? Це не видалить список заблокованих продавців.')) {
                    localStorage.removeItem(this.dataParser.cacheKey);
                    this.dataParser.adToSeller.clear();
                    this.updateStatsPanel();
                    alert('Кеш очищено!');
                }
            });
        }

        updateStatsPanel() {
            const content = document.getElementById('olx-stats-content');
            if (content) {
                content.innerHTML = `Заблоковано: ${this.blockedSellers.getCount()}<br>Кеш: ${this.dataParser.adToSeller.size} записів`;
            }

            const toggleBtn = document.getElementById('olx-toggle-visibility-btn');
            if (toggleBtn) {
                const isHidden = document.body.classList.contains('olx-hide-blocked');
                toggleBtn.textContent = isHidden ? '👁️ Показати заблокованих' : '🚫 Сховати заблокованих';
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

            message += '\nДля розблокування натисніть кнопку "Розблокувати" на картці оголошення';

            alert(message);
        }
    }

    function log(message) {
        if (CONFIG.DEBUG) {
            console.log(`[OLX Blocker] ${message}`);
        }
    }

    function init() {
        log('Инициализация OLX Seller Blocker...');

        const blockedSellers = new BlockedSellers();
        const dataParser = new OLXDataParser();
        const uiManager = new UIManager(blockedSellers, dataParser);

        let processAttempts = 0;
        const maxAttempts = 10;

        function tryProcessCards() {
            const cards = document.querySelectorAll('[data-cy="l-card"]');

            if (cards.length > 0) {
                log(`✓ Найдено ${cards.length} карточек, начинаю обработку...`);
                uiManager.processAllCards();
                return true;
            } else {
                processAttempts++;
                if (processAttempts < maxAttempts) {
                    log(`⏳ Карточки ещё не загружены, попытка ${processAttempts}/${maxAttempts}...`);
                    setTimeout(tryProcessCards, 500);
                } else {
                    log('⚠ Не удалось найти карточки после всех попыток');
                }
                return false;
            }
        }

        if (!tryProcessCards()) {
            setTimeout(tryProcessCards, 500);
        }

        setTimeout(() => {
            uiManager.createStatsPanel();
        }, 1000);

        let isProcessing = false;

        const observer = new MutationObserver((mutations) => {
            if (isProcessing) return;

            let hasNewCards = false;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === 1) {
                        if (node.hasAttribute && node.hasAttribute('data-olx-blocker-ad')) {
                            return;
                        }

                        if (node.hasAttribute && node.hasAttribute('data-cy') && node.getAttribute('data-cy') === 'l-card') {
                            hasNewCards = true;
                        }
                        const cards = node.querySelectorAll ? node.querySelectorAll('[data-cy="l-card"]') : [];
                        if (cards.length > 0) {
                            hasNewCards = true;
                        }
                    }
                });
            });

            if (hasNewCards) {
                isProcessing = true;
                log('🔄 Обнаружены новые карточки через MutationObserver');

                setTimeout(() => {
                    uiManager.processAllCards();
                    isProcessing = false;
                }, 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(() => {
            const cards = document.querySelectorAll('[data-cy="l-card"]');
            let missingButtons = 0;
            let hiddenCards = 0;

            cards.forEach(card => {
                const adId = card.id;
                if (!adId) return;

                const locationElement = card.querySelector('[data-testid="location-date"]');
                if (!locationElement) return;

                const parentDiv = locationElement.parentElement;
                const hasButton = parentDiv && parentDiv.querySelector(`[data-olx-blocker-ad="${adId}"]`);

                if (!hasButton) {
                    missingButtons++;
                } else {
                    const seller = dataParser.getSellerByAdId(adId);
                    if (seller && blockedSellers.isBlocked(seller.id)) {
                        if (!card.classList.contains('olx-blocked-card')) {
                            uiManager.hideCard(card);
                            hiddenCards++;
                        }
                    }
                }
            });

            if (missingButtons > 0) {
                log(`🔧 Обнаружено ${missingButtons} карточек без кнопок, восстанавливаю...`);
                uiManager.processAllCards();
            }

            if (hiddenCards > 0) {
                log(`🔧 Скрыто ${hiddenCards} карточек заблокированных продавцов`);
            }
        }, 3000);

        log('✓ Инициализация завершена, Observer активен');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }

})();
