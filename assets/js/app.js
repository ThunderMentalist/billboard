/* ThunderMentalist – Landing page logic
   - Loads /data/concerts.csv
   - Filters out past shows (Europe/London), sorts by Year/Month/Number
   - Renders cards: Band → image → date (Text) → venue → ticket → review placeholder
   - Genre filter (deduped union of Genre1/Genre2) with ?genre= in URL
   - Optional columns supported: ImageURL, ReviewURL, TopPick
   - Injects Event JSON-LD for the VISIBLE list
*/

(function(){
  'use strict';

  const CSV_URL = 'data/concerts.csv'; // upload your original CSV here

  // --- Month mapping (supports names and numbers) ---
  const MONTHS = {
    jan:0, january:0,
    feb:1, february:1,
    mar:2, march:2,
    apr:3, april:3,
    may:4,
    jun:5, june:5,
    jul:6, july:6,
    aug:7, august:7,
    sep:8, sept:8, september:8,
    oct:9, october:9,
    nov:10, november:10,
    dec:11, december:11
  };
  function monthToIndex(m){
    if(m == null) return null;
    const k = String(m).trim().toLowerCase();
    if (k in MONTHS) return MONTHS[k];
    if (isFinite(k)) return Number(k) - 1; // 1..12
    return null;
  }

  // --- Today in Europe/London, Y/M/D as numbers ---
  function todayInLondonYMD(){
    try{
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit'
      });
      const parts = fmt.formatToParts(Date.now())
        .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
      return {
        y: Number(parts.year),
        m: Number(parts.month),
        d: Number(parts.day)
      };
    }catch(e){
      // Fallback: local time
      const t = new Date();
      return { y: t.getFullYear(), m: t.getMonth()+1, d: t.getDate() };
    }
  }
  function compareYMD(a, b){
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  // --- Minimal CSV parser (handles quotes) ---
  function parseCSV(text){
    const rows = [];
    let row = [], field = '';
    let inQuotes = false, i = 0;

    while(i < text.length){
      const c = text[i];
      if(inQuotes){
        if(c === '"'){
          if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      } else {
        if(c === '"'){ inQuotes = true; i++; continue; }
        if(c === ','){ row.push(field); field=''; i++; continue; }
        if(c === '\n'){
          row.push(field); rows.push(row); row=[]; field=''; i++; continue;
        }
        if(c === '\r'){
          if(text[i+1] === '\n'){ i += 2; row.push(field); rows.push(row); row=[]; field=''; continue; }
          row.push(field); rows.push(row); row=[]; field=''; i++; continue;
        }
        field += c; i++;
      }
    }
    row.push(field); rows.push(row);
    const header = rows.shift().map(h => h.trim());
    return rows
      .filter(r => r.length && r.some(x => String(x).trim() !== ''))
      .map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
  }

  // --- Data helpers ---
  function buildYMDFromRow(row){
    // Use Number (day-of-month), Month, Year for sorting/comparison
    const y = Number(row['Year']);
    const mIdx = monthToIndex(row['Month']); // 0..11
    const d = Number(row['Number']);         // day-of-month
    return { y, m: (mIdx != null ? mIdx + 1 : null), d };
  }
  function isFutureOrToday(row, today){
    const ymd = buildYMDFromRow(row);
    if(!ymd.y || !ymd.m || !ymd.d) return true; // if missing, keep rather than discard
    return compareYMD({ y: ymd.y, m: ymd.m, d: ymd.d }, today) >= 0;
  }
  function sortByDateAsc(rows){
    return [...rows].sort((a, b) => {
      const A = buildYMDFromRow(a); const B = buildYMDFromRow(b);
      const ax = (A.y||9999)*10000 + (A.m||12)*100 + (A.d||31);
      const bx = (B.y||9999)*10000 + (B.m||12)*100 + (B.d||31);
      return ax - bx;
    });
  }

  // Deduped, case-insensitive list of genres over Genre1/Genre2
  function uniqueGenres(rows){
    const map = new Map();
    for(const r of rows){
      for(const g of [r['Genre1'], r['Genre2']]){
        if(!g) continue;
        const key = String(g).trim().toLowerCase();
        if(!key) continue;
        if(!map.has(key)) map.set(key, g.trim());
      }
    }
    // return array of [key, label], sorted by label
    return [...map.entries()].sort((a,b) => a[1].localeCompare(b[1]));
  }

  function readGenreFromURL(){
    const qp = new URLSearchParams(location.search);
    const g = qp.get('genre');
    return g ? String(g).toLowerCase() : '';
  }
  function writeGenreToURL(val){
    const qp = new URLSearchParams(location.search);
    if(val) qp.set('genre', val); else qp.delete('genre');
    history.replaceState(null, '', location.pathname + (qp.toString() ? ('?' + qp) : ''));
  }
  function applyGenreFilter(rows, key){
    if(!key) return rows;
    return rows.filter(r => {
      const g1 = String(r['Genre1']||'').toLowerCase();
      const g2 = String(r['Genre2']||'').toLowerCase();
      return g1 === key || g2 === key;
    });
  }

  // Placeholder image (4:3) as data URL
  function placeholderDataURL(text='Image coming soon'){
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0%' stop-color='#e5edf9'/>
          <stop offset='100%' stop-color='#cfd7e3'/>
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'
            font-family='system-ui' font-size='28' fill='#4a5568'>${String(text).replace(/&/g,'&amp;')}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  function injectEventSchema(rows){
    // Remove previously injected schema blocks
    document.querySelectorAll('script[data-schema="events"]').forEach(s => s.remove());

    const items = rows.map(r => {
      const ymd = buildYMDFromRow(r);
      const y = String(ymd.y || '').padStart(4,'0');
      const m = String(ymd.m || '').padStart(2,'0');
      const d = String(ymd.d || '').padStart(2,'0');
      const startDate = (y && m && d) ? `${y}-${m}-${d}` : undefined;
      const imgURL = (r['ImageURL'] && String(r['ImageURL']).trim()) ? String(r['ImageURL']).trim() : undefined;

      return {
        '@type': 'Event',
        name: r['Band'] || undefined,
        startDate,
        location: { '@type': 'Place', name: r['Venue'] || undefined },
        url: r['Link'] || undefined,
        image: imgURL
      };
    });

    const data = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: items.map((it, idx) => ({
        '@type': 'ListItem', position: idx + 1, item: it
      }))
    };
    const tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.dataset.schema = 'events';
    tag.textContent = JSON.stringify(data);
    document.head.appendChild(tag);
  }

  // Render the list of concerts
  function render(list){
    const container = document.getElementById('concertList');
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    for(const row of list){
      const isTop = String(row['TopPick'] || '').trim().toLowerCase() === 'true';

      const card = document.createElement('article');
      card.className = 'card' + (isTop ? ' top-pick' : '');

      if(isTop){
        const badge = document.createElement('div');
        badge.className = 'top-pick-badge';
        badge.textContent = 'Top Pick';
        card.appendChild(badge);
      }

      // Band name
      const band = document.createElement('div');
      band.className = 'band-name';
      band.textContent = row['Band'] || 'Untitled';

      // Image (placeholder or ImageURL if present)
      const imgWrap = document.createElement('a');
      imgWrap.href = (row['ImageURL'] && row['ImageURL'].trim()) ? row['ImageURL'] : '#';
      imgWrap.className = 'img-wrap';
      imgWrap.setAttribute('aria-label', `${row['Band'] || 'Band'} image`);

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = (row['ImageURL'] && row['ImageURL'].trim())
        ? row['ImageURL'].trim()
        : placeholderDataURL();
      img.alt = `${row['Band'] || 'Band'} promo image`;
      imgWrap.appendChild(img);

      // Meta (Date from Text, Venue)
      const meta = document.createElement('div');
      meta.className = 'meta';
      const dateRow = document.createElement('div');
      dateRow.className = 'row';
      dateRow.innerHTML = `<span class="label">Date:</span>${row['Text'] || ''}`;
      const venueRow = document.createElement('div');
      venueRow.className = 'row';
      venueRow.innerHTML = `<span class="label">Venue:</span>${row['Venue'] || ''}`;

      // Actions (Tickets, Review)
      const actions = document.createElement('div');
      actions.className = 'actions';

      const tix = document.createElement('a');
      tix.className = 'btn ticket';
      tix.textContent = 'Get Tickets';
      const href = row['Link'] && String(row['Link']).trim();
      if(href){
        tix.href = href;
        tix.target = '_blank';
        tix.rel = 'noopener noreferrer';
      }else{
        tix.href = '#';
        tix.setAttribute('aria-disabled', 'true');
      }

      const review = document.createElement('span');
      review.className = 'btn review';
      review.textContent = 'Review coming soon';
      // If future CSV includes ReviewURL, this could be an <a> instead:
      // if (row['ReviewURL']) { const a = document.createElement('a'); ... }

      actions.appendChild(tix);
      actions.appendChild(review);

      // Assemble card
      card.appendChild(band);
      card.appendChild(imgWrap);
      card.appendChild(meta);
      meta.appendChild(dateRow);
      meta.appendChild(venueRow);
      card.appendChild(actions);

      frag.appendChild(card);
    }

    container.appendChild(frag);
  }

  // Load CSV (no caching)
  async function loadCSV(){
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('Failed to load CSV: ' + res.status);
    const text = await res.text();
    return parseCSV(text);
  }

  // Initialize page
  async function init(){
    try{
      const all = await loadCSV();
      const today = todayInLondonYMD();

      // Filter out past
      const upcoming = all.filter(r => isFutureOrToday(r, today));

      // Sort ascending by date
      const sorted = sortByDateAsc(upcoming);

      // Populate dropdown
      const select = document.getElementById('genreSelect');
      const genres = uniqueGenres(sorted);
      for(const [key, label] of genres){
        const opt = document.createElement('option');
        opt.value = key; opt.textContent = label;
        select.appendChild(opt);
      }

      // Apply URL-driven filter
      const urlGenre = readGenreFromURL();
      if(urlGenre){
        // Match case-insensitive option
        const found = [...select.options].find(o => o.value.toLowerCase() === urlGenre);
        if(found) select.value = found.value; else writeGenreToURL('');
      }

      const applyAndRender = () => {
        const key = select.value.toLowerCase();
        const filtered = applyGenreFilter(sorted, key);
        render(filtered);
        writeGenreToURL(key);
        injectEventSchema(filtered);
      };

      select.addEventListener('change', applyAndRender);
      applyAndRender();

    }catch(err){
      const container = document.getElementById('concertList');
      container.innerHTML = `<p>Sorry, we couldn't load the concerts right now.</p>
        <pre style="white-space:pre-wrap;font-size:12px;">${String(err)}</pre>`;
      console.error(err);
    }
  }

  // Defer until DOM ready (script is loaded with defer in index.html)
  document.addEventListener('DOMContentLoaded', init);
})();
