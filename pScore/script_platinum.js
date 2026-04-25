const GAS_URL = "https://script.google.com/macros/s/AKfycbwQNkYx3soerv1YWR4ZUhwpkAqhGB1_348xmeF01lfNRQn4EpJB_oXP0o5YUhApawOk/exec";

let allScores = [];
let pScoreThreshold = 0; // PスコアRating50位の境界値を保存するための変数

/**
 * 起動時に実行
 */
async function initApp() {
    // 1. レベルや定数などの基本フィルタを初期化
    initFilters();

    // 2. GASから最新のユーザー一覧（シート名一覧）を取得してセレクトボックスを生成
    await refreshUserList();

    // 3. 最後に選択していたプレイヤー名を復元
    const userSelect = document.getElementById('user-select');
    const savedUser = localStorage.getItem('ongeki_last_user');

    // リストの中に保存されていた名前があればセットする
    if (savedUser && userSelect) {
        const options = Array.from(userSelect.options).map(o => o.value);
        if (options.includes(savedUser)) {
            userSelect.value = savedUser;
        }
    }

    // 4. 選択されているユーザーのキャッシュがあれば先に表示する
    const currentUser = userSelect ? userSelect.value : "";
    if (currentUser) {
        const cacheKey = `ongeki_cache_${currentUser}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            try {
                allScores = JSON.parse(cachedData);
                displayScores(allScores);
                document.getElementById('loading').style.display = 'none';
            } catch (e) {
                console.error("キャッシュ解析エラー:", e);
            }
        }
    }

    // 5. 最新データをGASから取得して更新
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

    // 取得開始時に保存しておく
    localStorage.setItem('ongeki_last_user', selectedUser);
    if (loadingEl) loadingEl.style.display = 'block';

    try {
        // GASに対し、?user=名前 の形式でリクエストを送る
        const cacheBuster = new Date().getTime();
        const url = `${GAS_URL}?user=${encodeURIComponent(selectedUser)}&_=${cacheBuster}`;
        const response = await fetch(url);

        const newData = await response.json();

        if (newData.error) {
            console.warn("データ未登録:", newData.error);
            allScores = [];
        } else {
            allScores = newData;
            // ユーザーごとのキーでキャッシュを保存
            localStorage.setItem(`ongeki_cache_${selectedUser}`, JSON.stringify(newData));
        }

        if (loadingEl) loadingEl.style.display = 'none';

        calculatepScoreAverage();

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

/**
 * フィルター（検索窓 + セレクトボックス）の値を読み取って表示を更新する
 */
function updateFilters() {
    const searchInput = document.getElementById('search-input');
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');
    const starSelect = document.getElementById('star-filter');

    if (!searchInput || !minSelect || !maxSelect || !starSelect) return;

    const searchText = searchInput.value.toLowerCase().trim();
    const minConst = parseFloat(minSelect.value);
    const maxConst = parseFloat(maxSelect.value);
    const starValue = starSelect.value;

    const filteredData = allScores.filter(item => {
        const title = String(item.title || "").toLowerCase();
        // 譜面定数がない場合は、検索にかかるように一時的に大きな値（または表示対象）にするか検討が必要
        // ここでは、定数がない曲は「level」の数値で代用して判定
        const constant = item.constant ? parseFloat(item.constant) : parseFloat(String(item.level).replace('+', '.7'));

        const matchesTitle = title.includes(searchText);
        const matchesConstant = (constant >= minConst && constant <= maxConst);

        // ★ランクの判定ロジック 
        let matchesStar = true;
        if (starValue !== 'all') {
            const pScore = parseFloat(item.platinumScore) || 0;
            const pMax = parseFloat(item.platinumMax) || 0;
            const pPercentNum = pMax > 0 ? (pScore / pMax) * 100 : 0;

            let currentRank = "";
            // displayScoresと同じ条件分岐
            if (pPercentNum >= 99) {
                currentRank = "rainbow"; // ★5虹
            } else if (pPercentNum >= 98) {
                currentRank = "star5";   // ★5金
            } else if (pPercentNum >= 97) {
                currentRank = "star4";
            } else if (pPercentNum >= 96) {
                currentRank = "star3";
            } else if (pPercentNum >= 95) {
                currentRank = "star2";
            } else if (pPercentNum >= 94) {
                currentRank = "star1";
            } else {
                currentRank = "none";
            }

            matchesStar = (currentRank === starValue);
        }

        return matchesTitle && matchesConstant && matchesStar;
    });

    sortData(filteredData);
    displayScores(filteredData);
}


// Ratingか達成率でのソート（デフォルトは前者）
let currentSortKey = 'rating'; // 'percent' または 'rating'

function sortData(data) {
    data.sort((a, b) => {
        if (currentSortKey === 'rating') {
            const ratingA = Number(a.platinumScoreRating) || 0;
            const ratingB = Number(b.platinumScoreRating) || 0;

            if (ratingB !== ratingA) return ratingB - ratingA;
        }
        const percentA = (Number(a.platinumMax) > 0) ? (Number(a.platinumScore) / Number(a.platinumMax)) : 0;
        const percentB = (Number(b.platinumMax) > 0) ? (Number(b.platinumScore) / Number(b.platinumMax)) : 0;
        return percentB - percentA;

    });
}

/**
 * 選択されたユーザーのPスコア枠平均（上位50）を計算して表示
 */
function calculatepScoreAverage() {
    const pScoreValueElement = document.getElementById('p-score-average');
    if (!pScoreValueElement) return;

    // 現在選択されているユーザー名を取得
    const userSelect = document.getElementById('user-select');
    const selectedUser = userSelect ? userSelect.value : "Unknown";

    // データがない場合の処理
    if (!allScores || allScores.length === 0) {
        pScoreValueElement.innerText = `${selectedUser}のPスコア枠平均:0.0000`;
        return;
    }

    // Rating値を抽出して数値化し、降順ソート
    const ratings = allScores
        .map(item => parseFloat(item.platinumScoreRating) || 0)
        .sort((a, b) => b - a);

    // 上位50個を切り出し
    const top50 = ratings.slice(0, 50);

    // 50位の数値を外の変数に保存（50件ない場合は最小値）
    pScoreThreshold = top50.length >= 50 ? top50[49] : 0;

    // 合計と平均（小数点第4位）を計算
    const sum = top50.reduce((acc, val) => acc + val, 0);
    const avg = sum / top50.length;

    // 指定のフォーマットで表示を更新
    pScoreValueElement.innerHTML = `${selectedUser}のPスコア枠平均:<span class="highlight-number">${avg.toFixed(4)}</span>`;
}

/**
 * セレクトボックスの選択肢(11.0〜16.0)を生成
 */
function initFilters() {
    const minSelect = document.getElementById('min-constant');
    const maxSelect = document.getElementById('max-constant');
    const searchInput = document.getElementById('search-input');
    const starSelect = document.getElementById('star-filter');

    if (!minSelect || !maxSelect) return;

    // 既存のオプションをクリア
    minSelect.innerHTML = "";
    maxSelect.innerHTML = "";

    // --- 定数の下限（11.0 → 16.0） ---
    for (let i = 110; i <= 160; i++) {
        const val = (i / 10).toFixed(1);
        const opt = `<option value="${val}">${val}</option>`;
        minSelect.insertAdjacentHTML('beforeend', opt);
    }

    // --- 定数の上限（16.0 → 11.0） ---
    for (let i = 160; i >= 110; i--) { // i-- で減らしていく
        const val = (i / 10).toFixed(1);
        const opt = `<option value="${val}">${val}</option>`;
        maxSelect.insertAdjacentHTML('beforeend', opt);
    }

    // 初期値の設定
    minSelect.value = "11.0";
    maxSelect.value = "16.0";

    // イベントリスナー
    minSelect.addEventListener('change', updateFilters);
    maxSelect.addEventListener('change', updateFilters);
    if (searchInput) {
        searchInput.addEventListener('input', updateFilters);
    }
    if (starSelect) {
        starSelect.addEventListener('change', updateFilters);
    }

    // クリアボタン
    const clearBtn = document.getElementById('clear-filter');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            minSelect.value = "11.0";
            maxSelect.value = "16.0";
            if (searchInput) searchInput.value = "";
            if (starSelect) starSelect.value = "all";
            updateFilters();
        });
    }

    // ソート切り替えボタンの取得
    const sortRatingBtn = document.getElementById('sort-pRating');
    const sortPercentBtn = document.getElementById('sort-percent');

    // Rating順ボタンのクリックイベント
    if (sortRatingBtn) {
        sortRatingBtn.addEventListener('click', () => {
            currentSortKey = 'rating';

            sortRatingBtn.classList.add('active');
            sortPercentBtn.classList.remove('active');

            updateFilters();
        });
    }

    // 達成率順ボタンのクリックイベント
    if (sortPercentBtn) {
        sortPercentBtn.addEventListener('click', () => {
            currentSortKey = 'percent';

            sortPercentBtn.classList.add('active');
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
    const header = document.getElementById('table-header');
    if (!body) return;

    // --- 1. ヘッダー（見出し）の順番を更新 ---
    if (header) {
        if (currentSortKey === 'rating') {
            header.innerHTML = `
                <th>楽曲情報</th>
                <th>Pスコア</th>
                <th>Rating</th>
                <th>次の★まで</th>
                <th>達成率</th>
            `;
        } else {
            header.innerHTML = `
                <th>楽曲情報</th>
                <th>Pスコア</th>
                <th>達成率</th>
                <th>次の★まで</th>
                <th>Rating</th>
            `;
        }
    }

    body.innerHTML = "";
    const fragment = document.createDocumentFragment();

    data.forEach(item => {
        const diff = String(item.difficulty || "").toUpperCase();
        if (diff === "BASIC" || diff === "ADVANCED") return;

        // --- 数値計算（既存ロジックそのまま） ---
        const pScore = parseFloat(item.platinumScore) || 0;
        const pMax = parseFloat(item.platinumMax) || 0;
        const pPercentNum = pMax > 0 ? (pScore / pMax) * 100 : 0;
        const pPercentStr = pPercentNum.toFixed(2);
        const isNum = !isNaN(parseFloat(item.constant)) && isFinite(item.constant);
        const displayLevel = isNum ? Number(item.constant).toFixed(1) : (item.level || "-");

        // --- 星と次ランク判定（既存ロジックそのまま） ---
        let nextGoalPercent = 94;
        let stars = "";
        let starClass = "";
        if (pPercentNum >= 99) { stars = "★5"; starClass = "star-rainbow"; nextGoalPercent = 100; }
        else if (pPercentNum >= 98) { stars = "★5"; starClass = "star-shine-5"; nextGoalPercent = 99; }
        else if (pPercentNum >= 97) { stars = "★4"; starClass = "star-shine-4"; nextGoalPercent = 98; }
        else if (pPercentNum >= 96) { stars = "★3"; starClass = "star-shine-3"; nextGoalPercent = 97; }
        else if (pPercentNum >= 95) { stars = "★2"; starClass = "star-shine-2"; nextGoalPercent = 96; }
        else if (pPercentNum >= 94) { stars = "★1"; starClass = "star-shine-1"; nextGoalPercent = 95; }
        else if (pPercentNum > 0) { stars = "★0"; starClass = "star-none"; nextGoalPercent = 94; }
        else { stars = ""; starClass = ""; nextGoalPercent = 94; }

        const nextGoalScore = Math.ceil(pMax * (nextGoalPercent / 100));
        const diffToNext = nextGoalScore - pScore;
        let nextText = pMax <= 0 ? "-" : (pScore <= 0 ? `あと ${nextGoalScore}` : (pScore >= pMax ? "MAX" : `あと ${diffToNext > 0 ? diffToNext : 1}`));
        let nextClass = pScore >= pMax ? "next-val is-max" : "next-val";

        const pRating = item.platinumScoreRating ?? "-";
        const pRatingNum = Number(pRating);
        const pRatingText = !isNaN(pRatingNum) ? pRatingNum.toFixed(3) : "-";

        // --- 2. 各セルをパーツ化 ---
        const cellTitle = `
            <td>
                <div class="title-cell">${item.title || "Unknown"}</div>
                <div class="diff-level-cell">${diff} ${displayLevel}</div>
            </td>`;

        const cellPScore = `
            <td class="p-score-cell">
                <div class="p-values">
                    <span class="plat-val">${pScore.toLocaleString()}</span>
                    <span class="plat-sub">/ ${pMax.toLocaleString()}</span>
                </div>
            </td>`;

        const cellPercent = `
            <td class="p-percent-cell">
                <span class="p-percent">${pPercentStr}%</span>
                <span class="p-star ${starClass}">${stars ? "(" + stars + ")" : ""}</span>
            </td>`;

        const cellNext = `
            <td class="p-next-cell">
                <span class="${nextClass}">${nextText}</span>
            </td>`;

        const cellRating = `
            <td class="p-rating-cell">
                <span class="p-percent">${pRatingText}</span>
            </td>`;

        // --- 3. テーブル行を作成して追加 ---
        const tr = document.createElement('tr');
        tr.className = diff.toLowerCase();
        if (typeof pScoreThreshold !== 'undefined' && pRatingNum >= pScoreThreshold && pRatingNum > 0) {
            tr.classList.add('top50-row');
        }

        // ソート順によってHTMLの結合順を変える
        if (currentSortKey === 'rating') {
            // Rating順のとき：曲名、Pスコア、Rating、次の★まで、達成率
            tr.innerHTML = cellTitle + cellPScore + cellRating + cellNext + cellPercent;
        } else {
            // 達成率順のとき：曲名、Pスコア、達成率、次の★まで、Rating
            tr.innerHTML = cellTitle + cellPScore + cellPercent + cellNext + cellRating;
        }

        fragment.appendChild(tr);
    });

    body.appendChild(fragment);
}