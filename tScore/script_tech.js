const GAS_URL = "https://script.google.com/macros/s/AKfycbwQNkYx3soerv1YWR4ZUhwpkAqhGB1_348xmeF01lfNRQn4EpJB_oXP0o5YUhApawOk/exec";

let allScores = [];
// レート対象の境界値を保存するオブジェクト
let rateThresholds = { best50: 0, new10: 0 };
let currentTypeFilter = 'all'; // 'all', 'old', 'new' を保持

/**
 * 起動時に実行
 */
async function initApp() {
    initFilters();
    await refreshUserList();

    const userSelect = document.getElementById('user-select');
    const savedUser = localStorage.getItem('ongeki_last_user');

    if (savedUser && userSelect) {
        const options = Array.from(userSelect.options).map(o => o.value);
        if (options.includes(savedUser)) userSelect.value = savedUser;
    }

    const currentUser = userSelect ? userSelect.value : "";
    if (currentUser) {
        const cacheKey = `ongeki_cache_v2_${currentUser}`;
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
            try {
                allScores = JSON.parse(cachedData);
                calculateOngekiRate();
                displayScores(allScores);
                document.getElementById('loading').style.display = 'none';
            } catch (e) { console.error("キャッシュ解析エラー:", e); }
        }
    }
    await loadLatestScores();
}

/**
 * GASからシート名一覧を取得してセレクトボックスを再構築する
 */
async function refreshUserList() {
    const userSelect = document.getElementById('user-select');
    if (!userSelect) return;

    try {
        // パラメータなしでGETリクエストを送り、ユーザー一覧を取得
        const cacheBuster = new Date().getTime(); // 現在時刻の数値を生成
        const url = `${GAS_URL}?_=${cacheBuster}`;
        const response = await fetch(url);
        const userList = await response.json();

        // セレクトボックスの中身をクリアして再構築
        userSelect.innerHTML = '';
        userList.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            userSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("ユーザーリストの取得に失敗しました:", e);
        // 失敗した場合は、手動設定用のデフォルト値を置くかエラー表示
        userSelect.innerHTML = '<option value="">(ユーザー読み込み失敗)</option>';
    }
}

/**
 * GASから最新データを取得
 */
async function loadLatestScores() {
    const userSelect = document.getElementById('user-select');
    const selectedUser = userSelect ? userSelect.value : "Unknown";
    const loadingEl = document.getElementById('loading');

    localStorage.setItem('ongeki_last_user', selectedUser);
    if (loadingEl) loadingEl.style.display = 'block';

    try {
        const cacheBuster = new Date().getTime();
        const url = `${GAS_URL}?user=${encodeURIComponent(selectedUser)}&_=${cacheBuster}`;
        const response = await fetch(url);
        const newData = await response.json();

        if (newData.error) {
            console.warn("データ未登録:", newData.error);
            allScores = [];
        } else {
            allScores = newData;
            localStorage.setItem(`ongeki_cache_v2_${selectedUser}`, JSON.stringify(newData));
        }

        if (loadingEl) loadingEl.style.display = 'none';

        // レート計算と表示更新
        calculateOngekiRate();
        updateFilters();
    } catch (e) {
        console.error("通信エラー:", e);
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// セレクトボックスが変更された時のイベントリスナーを追加
// (initFilters内で行ってもOKですが、ここにあると確実です)
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'user-select') {
        loadLatestScores();
    }
});

window.onload = initApp;


const LAMP_STRENGTH = { "AB+": 3, "AB": 2, "FC": 1, "None": 0 };

/**
 * フィルター（検索窓 + セレクトボックス）の値を読み取って表示を更新する
 */
function updateFilters() {
    const searchInput = document.getElementById('search-input');
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');
    const rankSelect = document.getElementById('rank-filter');
    const selectedLamps = Array.from(document.querySelectorAll('.combo-filter:checked'))
        .map(cb => cb.value);

    if (!searchInput || !minSelect || !maxSelect || !rankSelect) return;

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minSelect.value);
    const maxConst = parseFloat(maxSelect.value);
    const rankValue = rankSelect.value;

    const filteredData = allScores.filter(item => {
        const title = String(item.title || "").toLowerCase();
        // 譜面定数がない場合は、検索にかかるように一時的に大きな値（または表示対象）にするか検討が必要
        // ここでは、定数がない曲は「level」の数値で代用して判定
        const constant = item.constant ? parseFloat(item.constant) : parseFloat(String(item.level).replace('+', '.7'));

        const matchesTitle = title.includes(searchText);
        const matchesConstant = (constant >= minConst && constant <= maxConst);

        // ランクの判定ロジック 
        let matchesRank = true;
        if (rankValue !== 'all') {
            const tScore = parseFloat(item.technicalScore) || 0;

            let currentRank = "";
            if (tScore >= 1007500) {
                currentRank = "sssplus";
            } else if (tScore >= 1000000) {
                currentRank = "sss";
            } else if (tScore >= 990000) {
                currentRank = "ss";
            } else if (tScore >= 970000) {
                currentRank = "s";
            } else {
                currentRank = "none";
            }

            matchesRank = (currentRank === rankValue);
        }

        // ランプ判定
        const itemLamp = item.comboLamp || "None";

        let matchesLamp = false;
        if (selectedLamps.length === 0) {
            matchesLamp = false;
        } else {
            // 修正ポイント：選択されたランプのリスト（例：["AB+", "AB"]）に、その曲のランプが含まれているか
            matchesLamp = selectedLamps.includes(itemLamp);
        }

        // 表示対象（全曲/旧曲/新曲）判定
        let matchesType = true;
        if (currentTypeFilter === 'old') matchesType = !item.isNew;
        if (currentTypeFilter === 'new') matchesType = item.isNew;

        return matchesTitle && matchesConstant && matchesRank && matchesLamp && matchesType;
    });

    sortData(filteredData);
    displayScores(filteredData);
}


// Ratingかテクニカルスコアでのソート（デフォルトは前者）
let currentSortKey = 'rating'; // 'techScore' または 'rating'

function sortData(data) {
    data.sort((a, b) => {
        if (currentSortKey === 'rating') {
            const ratingA = Number(a.techScoreRating) || 0;
            const ratingB = Number(b.techScoreRating) || 0;

            if (ratingB !== ratingA) {
                return ratingB - ratingA;
            }
        }
        const techScoreA = Number(a.technicalScore) || 0;
        const techScoreB = Number(b.technicalScore) || 0;
        return techScoreB - techScoreA;
    });
}

/**
 * 3. レート計算（新10 + 旧50）
 */
function calculateOngekiRate() {
    const rateDisplay = document.getElementById('t-score-average');
    if (!rateDisplay) return;

    const userSelect = document.getElementById('user-select');
    const selectedUser = userSelect ? userSelect.value : "Unknown";

    if (!allScores || allScores.length === 0) {
        rateDisplay.innerText = `${selectedUser}のデータがありません`;
        return;
    }

    const newSongs = allScores.filter(s => s.isNew);
    const bestSongs = allScores.filter(s => !s.isNew);

    const getTopData = (list, count) => {
        const sorted = list
            .map(s => parseFloat(s.techScoreRating) || 0)
            .sort((a, b) => b - a);
        const top = sorted.slice(0, count);
        const avg = top.length > 0 ? top.reduce((a, b) => a + b, 0) / count : 0;
        const threshold = sorted.length >= count ? sorted[count - 1] : (sorted[sorted.length - 1] || 0);
        return { avg, threshold };
    };

    const newData = getTopData(newSongs, 10);
    const bestData = getTopData(bestSongs, 50);

    rateThresholds.new10 = newData.threshold;
    rateThresholds.best50 = bestData.threshold;

    const reachableRate = (newData.avg * 10 + bestData.avg * 50) / 60;

    // --- HTML出力（ベスト枠・新曲枠の数値にも highlight-number を適用） ---
    rateDisplay.innerHTML = `
    <strong>${selectedUser}</strong> 
    <span style="margin: 0 10px; color: #e0e0e0;">|</span>
    <span>ベスト枠: <span class="highlight-number">${bestData.avg.toFixed(3)}</span></span>
    <span style="margin: 0 10px; color: #e0e0e0;">|</span>
    <span>新曲枠: <span class="highlight-number">${newData.avg.toFixed(3)}</span></span>
`;
}

/**
 * フィルター初期化
 */
function initFilters() {
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');
    const searchInput = document.getElementById('search-input');
    const rankSelect = document.getElementById('rank-filter');
    const comboCheckboxes = document.querySelectorAll('.combo-filter');

    if (!minSelect || !maxSelect) return;

    minSelect.innerHTML = "";
    maxSelect.innerHTML = "";
    for (let i = 110; i <= 160; i++) {
        const val = (i / 10).toFixed(1);
        minSelect.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
    }
    for (let i = 160; i >= 110; i--) {
        const val = (i / 10).toFixed(1);
        maxSelect.insertAdjacentHTML('beforeend', `<option value="${val}">${val}</option>`);
    }

    minSelect.value = "11.0";
    maxSelect.value = "16.0";

    minSelect.addEventListener('change', updateFilters);
    maxSelect.addEventListener('change', updateFilters);
    if (searchInput) searchInput.addEventListener('input', updateFilters);
    if (rankSelect) rankSelect.addEventListener('change', updateFilters);
    comboCheckboxes.forEach(cb => cb.addEventListener('change', updateFilters));

    // ★追加: 表示対象（全曲/旧曲/新曲）ボタンのリスナー
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            if (e.target.id === 'filter-all') currentTypeFilter = 'all';
            else if (e.target.id === 'filter-old') currentTypeFilter = 'old';
            else if (e.target.id === 'filter-new') currentTypeFilter = 'new';

            updateFilters();
        });
    });

    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            minSelect.value = "11.0";
            maxSelect.value = "16.0";
            if (searchInput) searchInput.value = "";
            if (rankSelect) rankSelect.value = "all";
            comboCheckboxes.forEach(cb => cb.checked = true);
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            document.getElementById('filter-all').classList.add('active');
            currentTypeFilter = 'all';
            updateFilters();
        });
    }

    const sortRatingBtn = document.getElementById('sort-tRating');
    const sortScoreBtn = document.getElementById('sort-score');

    if (sortRatingBtn) {
        sortRatingBtn.addEventListener('click', () => {
            currentSortKey = 'rating';
            sortRatingBtn.classList.add('active');
            sortScoreBtn.classList.remove('active');
            updateFilters();
        });
    }
    if (sortScoreBtn) {
        sortScoreBtn.addEventListener('click', () => {
            currentSortKey = 'techScore';
            sortScoreBtn.classList.add('active');
            sortRatingBtn.classList.remove('active');
            updateFilters();
        });
    }
}

/**
 * 画面にスコアを表示する
 */
function displayScores(data) {
    const body = document.getElementById('score-body');
    if (!body) return;

    body.innerHTML = "";
    const fragment = document.createDocumentFragment();

    data.forEach(item => {
        const diff = String(item.difficulty || "").toUpperCase();
        if (diff === "BASIC" || diff === "ADVANCED") return;

        const tScore = parseFloat(item.technicalScore) || 0;
        const isNum = !isNaN(parseFloat(item.constant)) && isFinite(item.constant);
        const displayLevel = isNum ? Number(item.constant).toFixed(1) : (item.level || "-");

        const Rating = item.techScoreRating ?? "-";
        const RatingNum = Number(Rating);
        const RatingText = !isNaN(RatingNum) ? RatingNum.toFixed(3) : "-";

        // --- 1. ランプ表示の生成ロジック ---
        const combo = item.comboLamp || "None";
        const fb = item.fbLamp || "";
        let lampHtml = "";

        // A. comboLampの判定
        if (combo !== "None" && combo !== "") {
            let comboClass = "";
            let displayText = combo; // 表示するテキスト（AB+, AB, FC）

            if (combo === "AB+") {
                comboClass = "abplus-badge"; // 虹色
            } else if (combo === "AB") {
                comboClass = "ab-badge";    // オレンジ系
            } else if (combo === "FC") {
                comboClass = "fc-badge";    // 緑系
            }

            if (comboClass) {
                lampHtml += `<span class="${comboClass}">${displayText}</span>`;
            }
        }

        // B. fbLampの判定（鈴バッジ）
        if (fb === "FB") {
            lampHtml += `<span class="fb-badge">FB</span>`;
        }

        // 2. 新曲バッジ & タイトル ---
        const newBadge = item.isNew ? `<span class="new-song-label">NEW</span>` : "";

        const cellTitle = `
            <td>
                <div class="title-cell">${newBadge}${item.title || "Unknown"}</div>
                <div class="diff-level-cell">${diff} ${displayLevel}</div>
            </td>`;

        const cellLamp = `<td class="lamp-cell">${lampHtml}</td>`;
        const celltScore = `<td class="t-score-cell"><span class="t-score">${tScore.toLocaleString()}</span></td>`;
        const cellRating = `<td class="t-rating-cell"><span class="t-rating">${RatingText}</span></td>`;

        // --- 3. テーブル行の作成とハイライト判定 ---
        const tr = document.createElement('tr');
        tr.className = diff.toLowerCase();

        if (RatingNum > 0) {
            if (item.isNew && RatingNum >= rateThresholds.new10) {
                tr.classList.add('is-new-target'); // 新曲枠上位10曲
            } else if (!item.isNew && RatingNum >= rateThresholds.best50) {
                tr.classList.add('is-best-target'); // ベスト枠上位50曲
            }
        }

        tr.innerHTML = cellTitle + cellLamp + celltScore + cellRating;
        fragment.appendChild(tr);
    });

    body.appendChild(fragment);
}