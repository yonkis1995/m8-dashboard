import { MAPBOX_TOKEN, MAP_STYLE } from './config.js';
import {
  AFTER_2030,
  displayedRouteEffectRange,
  effectStartYear,
  formatClock,
  formatEffectRange,
  formatTimeRange,
  includedLengthKm,
  isAfter2030Period,
  isSectionActiveForPeriod,
  routeSectionWeight,
  routeCurrentTimeRange,
  routeTimeRange,
  sectionEffectRange,
  sectionsIncludedForPeriod,
} from './calculations.js';

const STATUS_COLORS = {
  working: '#f5b45f',
  approved: '#5b8def',
  design: '#a78bfa',
  planned: '#4dd7c8',
  other: '#7b8798',
};

const CITY_COORDS = {
  'МОСКВА': [37.6177, 55.7558],
  'ПУШКИНО': [37.8473, 56.0104],
  'ХОТЬКОВО': [37.9910, 56.2517],
  'СЕРГИЕВ ПОСАД': [38.1358, 56.3063],
  'АЛЕКСАНДРОВ': [38.7278, 56.3930],
  'АЛЕКСАНДРОВ 1': [38.7278, 56.3930],
  'СТРУНИНО': [38.5832, 56.3733],
  'КОЛЬЧУГИНО': [39.3858, 56.2993],
  'ЮРЬЕВ ПОЛЬСКИЙ': [39.6915, 56.5038],
  'ПЕРЕСЛАВЛЬ-ЗАЛЕССКИЙ': [38.8563, 56.7360],
  'ПЕРЕСЛАВЛЬ': [38.8563, 56.7360],
  'БЕРЕНДЕЕВО': [38.6118, 56.6018],
  'РОСТОВ ВЕЛИКИЙ': [39.4146, 57.1847],
  'РОСТОВ-ЯРОСЛАВСКИЙ': [39.4146, 57.1847],
  'ЯРОСЛАВЛЬ': [39.8938, 57.6261],
  'РЫБИНСК': [38.8426, 58.0485],
  'КОСТРОМА': [40.9269, 57.7679],
  'НЕРЕХТА': [40.5717, 57.4588],
  'ИВАНОВО': [40.9739, 56.9995],
  'ТЕЙКОВО': [40.5353, 56.8544],
  'ГАВРИЛОВ ПОСАД': [40.1180, 56.5593],
};

const app = document.querySelector('#app');
let data;
let geometry;
let map = null;
let selectedSectionId = null;
let currentRouteId = null;
let currentYear = 2029;
let currentProjectFilter = 'all';


function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function russianPlural(number, one, few, many) {
  const n = Math.abs(Number(number)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function statusKey(status = '') {
  const s = status.toLowerCase();
  if (s.includes('в работе')) return 'working';
  if (s.includes('утвержден')) return 'approved';
  if (s.includes('проектирован')) return 'design';
  if (s.includes('планир')) return 'planned';
  return 'other';
}

function statusColor(section) {
  return STATUS_COLORS[statusKey(section.status)] || STATUS_COLORS.other;
}

function normalizeCityName(value) {
  const key = normalizeMapKey(value);
  if (key === 'РОСТОВ-ЯРОСЛАВСКИЙ') return 'РОСТОВ ВЕЛИКИЙ';
  if (key === 'АЛЕКСАНДРОВ 1') return 'АЛЕКСАНДРОВ';
  if (key === 'ПЕРЕСЛАВЛЬ') return 'ПЕРЕСЛАВЛЬ-ЗАЛЕССКИЙ';
  return String(value ?? '').trim();
}

function normalizeRoutes(routes) {
  return routes.map((route) => ({
    ...route,
    origin: normalizeCityName(route.origin),
    destination: normalizeCityName(route.destination),
    originRegion: normalizeCityName(route.origin) === 'РОСТОВ ВЕЛИКИЙ' ? 'ЯРОСЛАВСКАЯ ОБЛАСТЬ' : route.originRegion,
    destinationRegion: normalizeCityName(route.destination) === 'РОСТОВ ВЕЛИКИЙ' ? 'ЯРОСЛАВСКАЯ ОБЛАСТЬ' : route.destinationRegion,
  }));
}

function uiRoutes() {
  const direct = normalizeRoutes(data.routes)
    .filter((route) => displayedRouteEffectRange(route, data.sections, AFTER_2030).max > 0);
  const seen = new Set();
  const result = [];
  direct.forEach((route) => {
    const directKey = `${route.origin}|${route.originRegion}|${route.destination}|${route.destinationRegion}`;
    if (!seen.has(directKey)) {
      seen.add(directKey);
      result.push(route);
    }
  });
  direct.forEach((route) => {
    if (route.origin === route.destination && route.originRegion === route.destinationRegion) return;
    const reverseKey = `${route.destination}|${route.destinationRegion}|${route.origin}|${route.originRegion}`;
    if (seen.has(reverseKey)) return;
    seen.add(reverseKey);
    result.push({
      ...route,
      id: `${route.id}__rev`,
      origin: route.destination,
      originRegion: route.destinationRegion,
      destination: route.origin,
      destinationRegion: route.originRegion,
      mirroredFrom: route.id,
    });
  });
  return result;
}

function currentRoute() {
  const routes = uiRoutes();
  return routes.find((r) => r.id === currentRouteId) || routes[0];
}

function sectionById(id) {
  return data.sections.find((s) => s.id === id);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function routeLabel(route) {
  return `${route.origin} → ${route.destination}`;
}

function periodLabel(period) {
  return isAfter2030Period(period) ? (data?.meta?.after2030Label || 'После 2030') : String(period);
}

function parsePeriod(value) {
  return value === AFTER_2030 ? AFTER_2030 : Number(value);
}

function sectionIncludedInScenario(section, period = currentYear) {
  return isAfter2030Period(period) ? Boolean(section.includeAfter2030 ?? true) : Boolean(section.includeInCalculations);
}

function normalizeMapKey(value) {
  return String(value ?? '').trim().toUpperCase();
}

function getCityCoords(name, region = '') {
  return CITY_COORDS[`${normalizeMapKey(name)}|${normalizeMapKey(region)}`]
    || CITY_COORDS[normalizeMapKey(name)]
    || null;
}

function routePointsGeojson() {
  const route = currentRoute();
  const originCoords = getCityCoords(route.origin, route.originRegion);
  const destinationCoords = getCityCoords(route.destination, route.destinationRegion);
  const features = [];
  if (originCoords) {
    features.push({
      type: 'Feature',
      properties: { id: 'origin', role: 'origin', label: route.origin, marker: 'А' },
      geometry: { type: 'Point', coordinates: originCoords },
    });
  }
  if (destinationCoords) {
    features.push({
      type: 'Feature',
      properties: { id: 'destination', role: 'destination', label: route.destination, marker: 'Б' },
      geometry: { type: 'Point', coordinates: destinationCoords },
    });
  }
  return { type: 'FeatureCollection', features };
}

function renderShell() {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"><img class="brand-mark-img" src="./favicon.png" alt="Логотип" /></div>
          <div class="brand-text">
            <div class="brand-title">М-8 «Холмогоры»</div>
            <div class="brand-subtitle">Аналитика строительства и реконструкции</div>
          </div>
        </div>
      </header>

      <main class="dashboard">
        <div class="hero-head">
          <div>
            <h1 class="hero-title">Планы по развитию М-8 «Холмогоры» и оценка эффектов на время в пути на автомобиле</h1>
            <p class="hero-copy">Интерактивная оценка влияния планируемых мероприятий на время в пути по автомобильным корреспонденциям.</p>
          </div>
          <div class="updated">Исходные данные: ${escapeHtml(data.meta.dataDate || '—')}</div>
        </div>

        <section class="kpis" id="kpis"></section>

        <section class="projects-panel projects-panel--top">
          <div class="projects-head">
            <h2>Мероприятия по строительству и реконструкции</h2>
            <div class="filter-group" id="projectFilters">
              <button class="filter-btn active" data-filter="all" type="button">Все</button>
              <button class="filter-btn" data-filter="included" type="button">В расчете</button>
              <button class="filter-btn" data-filter="excluded" type="button">Не в расчете</button>
            </div>
          </div>
          <div class="table-wrap"><table><thead><tr>
            <th>Участок</th><th>Статус</th><th>Ввод (план)</th><th>Протяженность</th><th>Эффект</th><th>Расчет</th>
          </tr></thead><tbody id="projectsBody"></tbody></table></div>
        </section>

        <section class="map-card">
          <div class="map-toolbar">
            <div class="route-controls">
              <div class="combo" id="originCombo">
                <label class="combo-label" for="originInput">Откуда</label>
                <input class="combo-input" id="originInput" autocomplete="off" spellcheck="false" />
                <span class="combo-chevron">⌄</span>
                <div class="combo-menu" id="originMenu"></div>
              </div>
              <div class="swap-mark">→</div>
              <div class="combo" id="destinationCombo">
                <label class="combo-label" for="destinationInput">Куда</label>
                <input class="combo-input" id="destinationInput" autocomplete="off" spellcheck="false" />
                <span class="combo-chevron">⌄</span>
                <div class="combo-menu" id="destinationMenu"></div>
              </div>
            </div>
            <div class="year-control" id="yearControl"></div>
          </div>

          <div class="map-stage">
            <div id="map"></div>
            <div class="legend" id="legend"></div>
            <aside class="section-drawer" id="sectionDrawer"></aside>
          </div>
        </section>

        <section class="time-panel" id="timePanel"></section>

        <div class="footer">
          <span>В качестве существующего времени в пути для корреспонденций с Москвой принято среднее время поездки при прибытии в Москву в утренний час-пик. Точка прибытия в Москве — ТТК.</span>
        </div>
      </main>
    </div>`;
}

function renderKpis() {
  const route = currentRoute();
  const included = sectionsIncludedForPeriod(data.sections, currentYear);
  const effect = displayedRouteEffectRange(route, data.sections, currentYear);
  const time = routeTimeRange(route, data.sections, currentYear);
  const km = includedLengthKm(data.sections, currentYear);
  const period = periodLabel(currentYear);
  const effectText = effect.max > 0 ? formatEffectRange(effect) : '0 мин';
  const timeText = formatTimeRange(time);
  const measuresWord = russianPlural(included.length, 'мероприятие', 'мероприятия', 'мероприятий');
  document.querySelector('#kpis').innerHTML = `
    <article class="kpi"><div class="kpi-value">${included.length}</div><div class="kpi-label">${measuresWord} <span class="kpi-context">в расчетном сценарии</span></div></article>
    <article class="kpi"><div class="kpi-value">${Math.round(km)} км</div><div class="kpi-label">протяженность <span class="kpi-context">учтенных участков</span></div></article>
    <article class="kpi accent"><div class="kpi-value">${effectText}</div><div class="kpi-label">экономия времени для маршрута <span class="kpi-context">${escapeHtml(routeLabel(route))} · ${escapeHtml(period)}</span></div></article>
    <article class="kpi"><div class="kpi-value">${timeText}</div><div class="kpi-label">время в пути <span class="kpi-context">${escapeHtml(routeLabel(route))} · ${escapeHtml(period)}</span></div></article>`;
}

function renderYears() {
  const host = document.querySelector('#yearControl');
  const periods = data.meta.periods || data.meta.years || [2026, 2027, 2028, 2029, AFTER_2030];
  host.innerHTML = periods.map((period) => `<button class="year-btn ${period === currentYear ? 'active' : ''}" data-period="${escapeHtml(period)}" type="button">${escapeHtml(periodLabel(period))}</button>`).join('');
  host.querySelectorAll('[data-period]').forEach((btn) => btn.addEventListener('click', () => setYear(parsePeriod(btn.dataset.period))));
}

function renderLegend() {
  const order = ['working', 'approved', 'design', 'planned', 'other'];
  const labels = {
    working: 'В работе',
    approved: 'Утверждено',
    design: 'Проектирование',
    planned: 'Планируется',
    other: 'Прочее',
  };
  const present = uniqueBy(
    data.sections.map((section) => ({ key: statusKey(section.status), label: labels[statusKey(section.status)] || section.status })),
    (item) => item.key,
  ).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  document.querySelector('#legend').innerHTML = present.map(({ key, label }) => `
    <div class="legend-item"><span class="legend-dot" style="background:${STATUS_COLORS[key]}"></span>${label}</div>`).join('');
}

function renderTimePanel() {
  const route = currentRoute();
  const base = route.currentTimeMinutes;
  const periods = data.meta.periods || [...(data.meta.years || []), AFTER_2030];
  const latestPeriod = periods.includes(AFTER_2030) ? AFTER_2030 : periods[periods.length - 1];
  const latestEffect = displayedRouteEffectRange(route, data.sections, latestPeriod);
  const steps = periods.map((period) => {
    const time = period === 2026
      ? routeCurrentTimeRange(route, data.sections)
      : routeTimeRange(route, data.sections, period);
    return {
      period,
      label: period === 2026 ? 'Сущ. положение' : periodLabel(period),
      timeText: formatTimeRange(time),
      effect: period === 2026 ? { min: 0, max: 0 } : displayedRouteEffectRange(route, data.sections, period),
    };
  });

  document.querySelector('#timePanel').innerHTML = `
    <div class="panel-heading">
      <div><h2>Изменение времени в пути</h2><p>${escapeHtml(routeLabel(route))} · ${Math.round(route.distanceKm || 0)} км</p></div>
      <div class="route-effect-summary"><strong>${latestEffect.max > 0 ? formatEffectRange(latestEffect) : '0 мин'}</strong><span>${isAfter2030Period(latestPeriod) ? 'экономия после 2030' : `экономия к ${latestPeriod} году`}</span></div>
    </div>
    <div class="time-strip">
      ${steps.map((step) => `<button class="time-step ${step.period === currentYear ? 'active' : ''}" data-time-period="${escapeHtml(step.period)}" type="button">
        <div class="time-year">${escapeHtml(step.label)}</div>
        <div class="time-value">${step.timeText}</div>
        <div class="time-delta ${step.effect.max > 0 ? 'good' : ''}">${step.effect.max > 0 ? `экономия ${formatEffectRange(step.effect)}` : 'базовый диапазон'}</div>
      </button>`).join('')}
    </div>`;
  document.querySelectorAll('[data-time-period]').forEach((btn) => btn.addEventListener('click', () => setYear(parsePeriod(btn.dataset.timePeriod))));
}

function renderProjects() {
  const route = currentRoute();
  const body = document.querySelector('#projectsBody');
  const filtered = data.sections.filter((section) => {
    const included = sectionIncludedInScenario(section, currentYear);
    if (currentProjectFilter === 'included') return included;
    if (currentProjectFilter === 'excluded') return !included;
    return true;
  });
  body.innerHTML = filtered.map((section) => {
    const effect = sectionEffectRange(section);
    const active = routeSectionWeight(route, section.id, currentYear) > 0 && isSectionActiveForPeriod(section, currentYear);
    const included = sectionIncludedInScenario(section, currentYear);
    return `<tr data-section-row="${section.id}" ${active ? 'title="Участок влияет на выбранную корреспонденцию в этом периоде"' : ''}>
      <td class="cell-name">${escapeHtml(section.name)}</td>
      <td><span class="status-cell"><span class="status-dot" style="background:${statusColor(section)}"></span>${escapeHtml(section.status)}</span></td>
      <td>${escapeHtml(section.commissionYear || '—')}</td>
      <td>${escapeHtml(section.newLengthKm)} км</td>
      <td>${effect.max > 0 ? formatEffectRange(effect) : '—'}</td>
      <td><span class="calc-pill ${included ? 'yes' : ''}">${included ? 'Да' : 'Нет'}</span></td>
    </tr>`;
  }).join('');
  body.querySelectorAll('[data-section-row]').forEach((row) => row.addEventListener('click', () => selectSection(row.dataset.sectionRow, true)));
}

function renderDrawer() {
  const drawer = document.querySelector('#sectionDrawer');
  const section = sectionById(selectedSectionId);
  if (!section) {
    drawer.classList.remove('open');
    drawer.innerHTML = '';
    return;
  }
  const effect = sectionEffectRange(section);
  const color = statusColor(section);
  const isTollBypass = section.id === 'm8-115-135';
  const beforeSpeed = `${escapeHtml(section.speedBeforeBadKmh)}–${escapeHtml(section.speedBeforeNormalKmh)} км/ч`;
  const compare = isTollBypass ? `
    <div class="compare">
      <div class="head"></div><div class="head">Существующая М-8</div><div class="head">Платный дублер</div>
      <div class="label">Протяженность</div><div class="val">${escapeHtml(section.existingLengthKm)} км</div><div class="val">${escapeHtml(section.newLengthKm)} км</div>
      <div class="label">Количество полос</div><div class="val">${escapeHtml(section.lanesBefore || '—')}</div><div class="val">${escapeHtml(section.lanesAfter || '—')}</div>
      <div class="label">Средняя скорость движения</div><div class="val">${beforeSpeed}</div><div class="val">${escapeHtml(section.speedAfterBadKmh)}–${escapeHtml(section.speedAfterNormalKmh)} км/ч</div>
    </div>` : `
    <div class="compare">
      <div class="head"></div><div class="head">Сущ. положение</div><div class="head">После ввода</div>
      <div class="label">Количество полос</div><div class="val">${escapeHtml(section.lanesBefore || '—')}</div><div class="val">${escapeHtml(section.lanesAfter || '—')}</div>
      <div class="label">Средняя скорость движения</div><div class="val">${beforeSpeed}</div><div class="val">${escapeHtml(section.speedAfterBadKmh)}–${escapeHtml(section.speedAfterNormalKmh)} км/ч</div>
    </div>`;
  drawer.innerHTML = `
    <div class="drawer-head">
      <div><h3 class="drawer-title">${escapeHtml(section.name)}</h3>
        <div class="badges">
          <span class="badge"><span class="badge-dot" style="background:${color}"></span>${escapeHtml(section.status)}</span>
          <span class="badge">Ввод (план): ${escapeHtml(section.commissionYear || 'не определен')}</span>
        </div>
      </div>
      <button class="drawer-close" id="drawerClose" type="button" aria-label="Закрыть">×</button>
    </div>
    <div class="drawer-metric"><div><strong>${formatEffectRange(effect)}</strong><br><span>экономия времени</span></div><div><strong>${escapeHtml(section.newLengthKm)} км</strong><br><span>${isTollBypass ? 'длина дублера' : 'протяженность'}</span></div></div>
    ${compare}
    <div class="target-state"><b>Целевое состояние:</b> ${escapeHtml(section.targetState || '—')}</div>
    ${section.sources?.length ? `<div class="sources">${section.sources.map((url, i) => `<a class="source-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span>Источник ${i + 1}</span><span>↗</span></a>`).join('')}</div>` : ''}`;
  drawer.classList.add('open');
  drawer.querySelector('#drawerClose').addEventListener('click', () => selectSection(null));
}

function setYear(period) {
  currentYear = period;
  renderKpis();
  renderYears();
  renderTimePanel();
  renderProjects();
  refreshMapData();
}

function selectSection(id, zoom = false) {
  selectedSectionId = id;
  renderDrawer();
  refreshMapData();
  if (zoom && id) zoomToSection(id);
}

function setupCombobox(comboId, inputId, menuId, getItems, getValue, onSelect) {
  const combo = document.querySelector(`#${comboId}`);
  const input = document.querySelector(`#${inputId}`);
  const menu = document.querySelector(`#${menuId}`);

  function paint(query = '') {
    const q = query.trim().toLowerCase();
    const items = getItems().filter((item) => `${item.name} ${item.region}`.toLowerCase().includes(q)).slice(0, 30);
    menu.innerHTML = items.length ? items.map((item) => `<div class="combo-option" data-key="${escapeHtml(item.key)}"><div>${escapeHtml(item.name)}</div><small>${escapeHtml(item.region)}</small></div>`).join('') : '<div class="combo-option"><small>Нет совпадений</small></div>';
    menu.querySelectorAll('[data-key]').forEach((node) => node.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const found = items.find((x) => x.key === node.dataset.key);
      if (found) {
        onSelect(found);
        combo.classList.remove('open');
      }
    }));
  }

  input.addEventListener('focus', () => { paint(''); combo.classList.add('open'); });
  input.addEventListener('input', () => { paint(input.value); combo.classList.add('open'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') combo.classList.remove('open');
    if (e.key === 'Enter') {
      const first = menu.querySelector('[data-key]');
      if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => combo.classList.remove('open'), 100);
    setTimeout(() => { input.value = getValue(); }, 110);
  });
}

function updateRouteInputs() {
  const route = currentRoute();
  document.querySelector('#originInput').value = route.origin;
  document.querySelector('#destinationInput').value = route.destination;
}

function originItems() {
  const routes = uiRoutes();
  return uniqueBy(routes.map((r) => ({ key: `${r.origin}|${r.originRegion}`, name: r.origin, region: r.originRegion })), (x) => x.key);
}

function destinationItems() {
  const route = currentRoute();
  const routes = uiRoutes();
  return uniqueBy(routes
    .filter((r) => r.origin === route.origin && r.originRegion === route.originRegion)
    .filter((r) => !(r.destination === route.origin && r.destinationRegion === route.originRegion))
    .map((r) => ({ key: `${r.destination}|${r.destinationRegion}`, name: r.destination, region: r.destinationRegion })), (x) => x.key);
}

function selectOrigin(item) {
  const routes = uiRoutes();
  const current = currentRoute();
  const candidates = routes.filter((r) => r.origin === item.name && r.originRegion === item.region && !(r.destination === item.name && r.destinationRegion === item.region));
  const next = candidates.find((r) => r.destination === current.destination && r.destinationRegion === current.destinationRegion)
    || candidates.find((r) => r.destination === 'МОСКВА')
    || candidates[0];
  if (!next) return;
  currentRouteId = next.id;
  selectedSectionId = null;
  updateRouteInputs();
  refreshDashboard();
  focusCurrentRoute();
}

function selectDestination(item) {
  const route = currentRoute();
  if (item.name === route.origin && item.region === route.originRegion) return;
  const routes = uiRoutes();
  const next = routes.find((r) => r.origin === route.origin && r.originRegion === route.originRegion && r.destination === item.name && r.destinationRegion === item.region);
  if (!next) return;
  currentRouteId = next.id;
  selectedSectionId = null;
  updateRouteInputs();
  refreshDashboard();
  focusCurrentRoute();
}

function decoratedGeojson() {
  const route = currentRoute();
  return {
    type: 'FeatureCollection',
    features: geometry.features.map((feature) => {
      const section = sectionById(feature.properties.id);
      const active = section ? isSectionActiveForPeriod(section, currentYear) : false;
      const routeRelevant = section ? routeSectionWeight(route, section.id, currentYear) > 0 : false;
      const routeActive = routeRelevant && active;
      const start = section ? effectStartYear(section) : null;
      const future = !isAfter2030Period(currentYear) && start !== null && Number(currentYear) < start;
      const routeFuture = routeRelevant && future;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          color: section ? statusColor(section) : STATUS_COLORS.other,
          included: Boolean(section && sectionIncludedInScenario(section, currentYear)),
          active,
          routeRelevant,
          routeActive,
          future,
          routeFuture,
          selected: feature.properties.id === selectedSectionId,
        },
      };
    }),
  };
}

function routeBounds() {
  const route = currentRoute();
  const coords = [];
  const originCoords = getCityCoords(route.origin, route.originRegion);
  const destinationCoords = getCityCoords(route.destination, route.destinationRegion);
  if (originCoords) coords.push(originCoords);
  if (destinationCoords) coords.push(destinationCoords);
  geometry.features.forEach((feature) => {
    const section = sectionById(feature.properties.id);
    if (section && routeSectionWeight(route, section.id, currentYear) > 0) {
      feature.geometry.coordinates.forEach((point) => coords.push(point));
    }
  });
  return coords;
}

function fitBoundsFromCoords(coords, opts = {}) {
  if (!map || !coords?.length) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  map.fitBounds([[minX, minY], [maxX, maxY]], {
    padding: { top: 70, right: 110, bottom: 70, left: 70 },
    duration: opts.duration ?? 700,
    maxZoom: opts.maxZoom ?? 9.6,
  });
  return true;
}

function focusCurrentRoute() {
  if (!map) return;
  const ok = fitBoundsFromCoords(routeBounds(), { duration: 700, maxZoom: 9.6 });
  if (!ok) fitAllSections();
}

function initMap() {
  if (!MAPBOX_TOKEN || !window.mapboxgl || !window.mapboxgl.supported()) {
    renderFallbackMap();
    return;
  }
  window.mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new window.mapboxgl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: [38.65, 56.66],
    zoom: 7.1,
    attributionControl: true,
    pitchWithRotate: false,
  });
  map.addControl(new window.mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.on('load', () => {
    map.addSource('sections', { type: 'geojson', data: decoratedGeojson(), promoteId: 'id' });
    map.addSource('route-points', { type: 'geojson', data: routePointsGeojson() });
    map.addLayer({
      id: 'sections-glow', type: 'line', source: 'sections',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 13, ['boolean', ['get', 'routeActive'], false], 10, 7],
        'line-opacity': ['case', ['boolean', ['get', 'selected'], false], .24, ['boolean', ['get', 'routeActive'], false], .2, .04],
        'line-blur': 4,
      },
    });
    map.addLayer({
      id: 'sections-solid', type: 'line', source: 'sections',
      filter: ['==', ['get', 'included'], true],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 7, ['boolean', ['get', 'routeActive'], false], 6.2, ['boolean', ['get', 'routeRelevant'], false], 5.1, ['boolean', ['get', 'active'], false], 4.6, 3.8],
        'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 1, ['boolean', ['get', 'routeActive'], false], 1, ['boolean', ['get', 'routeFuture'], false], .42, ['boolean', ['get', 'routeRelevant'], false], .34, ['boolean', ['get', 'future'], false], .16, ['boolean', ['get', 'active'], false], .2, .14],
      },
    });
    map.addLayer({
      id: 'sections-dashed', type: 'line', source: 'sections',
      filter: ['==', ['get', 'included'], false],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 6, 4],
        'line-opacity': ['case', ['boolean', ['get', 'selected'], false], .95, ['boolean', ['get', 'routeRelevant'], false], .54, .2],
        'line-dasharray': [2, 1.6],
      },
    });
    map.addLayer({
      id: 'route-points-halo', type: 'circle', source: 'route-points',
      paint: {
        'circle-radius': 18,
        'circle-color': ['match', ['get', 'role'], 'origin', '#5B8DEF', 'destination', '#35C6A8', '#9db0c7'],
        'circle-opacity': 0.22,
        'circle-blur': 0.35,
      },
    });
    map.addLayer({
      id: 'route-points', type: 'circle', source: 'route-points',
      paint: {
        'circle-radius': 10,
        'circle-color': ['match', ['get', 'role'], 'origin', '#5B8DEF', 'destination', '#35C6A8', '#9db0c7'],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#F7FAFC',
      },
    });
    map.addLayer({
      id: 'route-point-letters', type: 'symbol', source: 'route-points',
      layout: {
        'text-field': ['get', 'marker'],
        'text-size': 10,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#FFFFFF',
      },
    });
    map.addLayer({
      id: 'route-labels', type: 'symbol', source: 'route-points',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 12,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
        'text-offset': [0, 1.55],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#eef6ff',
        'text-halo-color': 'rgba(18, 31, 46, 0.96)',
        'text-halo-width': 1.2,
      },
    });

    ['route-points', 'route-point-letters'].forEach((layer) => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'default'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });
    ['sections-solid', 'sections-dashed'].forEach((layer) => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) selectSection(id, false);
      });
    });
    focusCurrentRoute();
  });
}

function featureBounds(feature) {
  const coords = feature.geometry.coordinates;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  coords.forEach(([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return [[minX, minY], [maxX, maxY]];
}

function fitAllSections() {
  if (!map) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  geometry.features.forEach((f) => f.geometry.coordinates.forEach(([x, y]) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }));
  map.fitBounds([[minX, minY], [maxX, maxY]], { padding: { top: 70, right: 70, bottom: 70, left: 70 }, duration: 0 });
}

function zoomToSection(id) {
  if (!map) return;
  const feature = geometry.features.find((f) => f.properties.id === id);
  if (!feature) return;
  map.fitBounds(featureBounds(feature), { padding: 90, duration: 700, maxZoom: 12.5 });
}

function refreshMapData() {
  if (map?.getSource('sections')) {
    map.getSource('sections').setData(decoratedGeojson());
    if (map.getSource('route-points')) map.getSource('route-points').setData(routePointsGeojson());
  } else if (!map) {
    renderFallbackMap();
  }
}

function renderFallbackMap() {
  const host = document.querySelector('#map');
  if (!host || !geometry) return;
  const all = geometry.features.flatMap((f) => f.geometry.coordinates);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = (maxX - minX) * .08 || .1;
  const padY = (maxY - minY) * .08 || .1;
  const view = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
  const W = 1200, H = 620;
  const project = ([x, y]) => [((x - view.minX) / (view.maxX - view.minX)) * W, H - ((y - view.minY) / (view.maxY - view.minY)) * H];
  const route = currentRoute();
  const lines = geometry.features.map((f) => {
    const s = sectionById(f.properties.id);
    if (!s) return '';
    const pts = f.geometry.coordinates.map(project).map((p) => p.join(',')).join(' ');
    const active = isSectionActiveForPeriod(s, currentYear);
    const relevant = routeSectionWeight(route, s.id, currentYear) > 0;
    const routeActive = relevant && active;
    const routeFuture = relevant && !active;
    const selected = s.id === selectedSectionId;
    const included = sectionIncludedInScenario(s, currentYear);
    const opacity = !included ? (relevant ? .54 : .2) : routeActive ? 1 : routeFuture ? .42 : active ? .2 : .14;
    const dash = !included ? 'stroke-dasharray="11 8"' : '';
    const width = selected ? 9 : routeActive ? 7.5 : relevant ? 6 : active ? 4.5 : 4;
    return `<polyline data-fallback-section="${s.id}" points="${pts}" fill="none" stroke="${statusColor(s)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" ${dash}/>`;
  }).join('');
  host.innerHTML = `<div class="map-fallback">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="Схематичное отображение участков М-8">
      <defs><pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 60" fill="none" stroke="#1b2633" stroke-width="1" opacity=".45"/></pattern></defs>
      <rect width="100%" height="100%" fill="url(#grid)"/>
      ${lines}
    </svg>
  </div>`;
  host.querySelectorAll('[data-fallback-section]').forEach((line) => {
    line.style.cursor = 'pointer';
    line.addEventListener('click', () => selectSection(line.dataset.fallbackSection));
  });
}

function refreshDashboard() {
  renderKpis();
  renderYears();
  renderTimePanel();
  renderProjects();
  renderDrawer();
  updateRouteInputs();
  refreshMapData();
}

function bindGlobalEvents() {
  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    currentProjectFilter = b.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
    renderProjects();
  }));

  setupCombobox('originCombo', 'originInput', 'originMenu', originItems, () => currentRoute().origin, selectOrigin);
  setupCombobox('destinationCombo', 'destinationInput', 'destinationMenu', destinationItems, () => currentRoute().destination, selectDestination);
}

async function fetchJson(...candidates) {
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Не удалось загрузить JSON');
}

async function bootstrap() {
  [data, geometry] = await Promise.all([
    fetchJson('./data/baseline.json', './public/data/baseline.json'),
    fetchJson('./data/sections.geojson', './public/data/sections.geojson'),
  ]);
  data = { ...data, routes: normalizeRoutes(data.routes) };
  currentRouteId = data.meta.defaultRouteId || data.routes[0]?.id;
  currentYear = data.meta.defaultYear || 2029;

  renderShell();
  bindGlobalEvents();
  renderLegend();
  updateRouteInputs();
  refreshDashboard();
  initMap();
}

bootstrap().catch((error) => {
  console.error(error);
  app.innerHTML = `<div style="padding:40px;color:#e5e7eb;font-family:system-ui">Не удалось загрузить данные приложения.<br><small style="color:#94a3b8">${escapeHtml(error.message)}</small></div>`;
});