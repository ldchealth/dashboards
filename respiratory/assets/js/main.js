/* ==========================================================================
   Lawrence-Douglas County Public Health â€” Dashboard logic
   Loads three static JSON files (produced by the Jupyter notebook) and
   renders responsive Chart.js line charts, plus a staff-authored narrative.
   No build step, no CDN needed.
   ========================================================================== */

(function () {
  "use strict";

  // ---- Mobile nav toggle ----
  const navToggle = document.getElementById("navToggle");
  const mainNav = document.getElementById("mainNav");
  navToggle.addEventListener("click", () => {
    const open = mainNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  mainNav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      mainNav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    })
  );

  document.getElementById("year").textContent = new Date().getFullYear();

  // ---- Brand color tokens (mirrors styles.css) ----
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();

  const PATHOGEN_META = {
    covid: {
      label: "COVID-19",
      strong: color("--covid-strong"),
      soft: color("--covid-soft"),
    },
    influenza: {
      label: "Influenza",
      strong: color("--flu-strong"),
      soft: color("--flu-soft"),
    },
    rsv: {
      label: "RSV",
      strong: color("--rsv-strong"),
      soft: color("--rsv-soft"),
    },
  };

  const DATA_URLS = {
    ed: "assets/data/ed_visits.json",
    ww: "assets/data/wastewater.json",
    narrative: "assets/data/narrative.json",
  };

  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = "#575757";

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }


  function addInfluenzaChartStyles() {
    const style = document.createElement("style");

    style.textContent = `
      .flu-wastewater-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        width: 100%;
      }

      .flu-wastewater-panel {
        min-width: 0;
        padding: 0;
        background: transparent;
      }

      .flu-wastewater-title {
        margin: 0 0 0.5rem;
        font-size: 0.95rem;
        font-weight: 650;
        text-align: center;
        color: #3d4348;
      }

      .flu-wastewater-canvas-wrap {
        position: relative;
        width: 100%;
        height: 275px;
      }

      @media (max-width: 700px) {
        .flu-wastewater-grid {
          grid-template-columns: 1fr;
          gap: 1.5rem;
        }

        .flu-wastewater-canvas-wrap {
          height: 250px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  
  document.getElementById("year").textContent =
    new Date().getFullYear();
  
  
  addInfluenzaChartStyles();


  // ---- Fetch all three datasets ----
  Promise.all([
    fetch(DATA_URLS.ed).then((r) => r.json()),
    fetch(DATA_URLS.ww).then((r) => r.json()),
    fetch(DATA_URLS.narrative).then((r) => r.json()).catch(() => null),
  ])
    .then(([edData, wwData, narrativeData]) => {
      renderLastUpdated(edData, wwData, narrativeData);
      renderNarrative(narrativeData);

      // Reads the "illnesses" array (renamed from "pathogens") in both
      // ed_visits.json and wastewater.json.
      Object.keys(PATHOGEN_META).forEach((key) => {
      const edSeries = findPathogen(edData.illnesses, key);

      if (!edSeries) return;

      // Influenza wastewater is stored as two distinct series:
      // flua and flub. Render them as separate charts with
      // independent vertical axes.
      if (key === "influenza") {
        const fluASeries = findPathogen(wwData.illnesses, "flua");
        const fluBSeries = findPathogen(wwData.illnesses, "flub");

        if (!fluASeries || !fluBSeries) return;

        const fluWastewaterDates = [
          ...(fluASeries.points || []).map((p) => p.date),
          ...(fluASeries.previous_points || []).map((p) =>
            shiftToCurrentYear(p.date)
          ),
          ...(fluBSeries.points || []).map((p) => p.date),
          ...(fluBSeries.previous_points || []).map((p) =>
            shiftToCurrentYear(p.date)
          ),
        ];

        const shared = computeSharedXAxis(
          getEdDatesForAxis(edSeries),
          fluWastewaterDates
        );

        renderEdChart(key, edSeries, edData.unit, shared);

        renderInfluenzaWastewaterCharts(
          fluASeries,
          fluBSeries,
          wwData.unit,
          shared
        );

        return;
      }

      // COVID-19 and RSV each have one wastewater series.
      const wwSeries = findPathogen(wwData.illnesses, key);

      if (!wwSeries) return;

      const wwCurrentPoints = wwSeries.points || [];
      const wwPreviousPoints = wwSeries.previous_points || [];

      const wwDatesForAxis =
        wwCurrentPoints.map((p) => p.date);

      const shared = computeSharedXAxis(
        getEdDatesForAxis(edSeries),
        wwDatesForAxis
      );

      renderEdChart(key, edSeries, edData.unit, shared);
      renderWastewaterChart(
        key,
        wwSeries,
        wwData.unit,
        shared
      );
    });
    })
    .catch((err) => {
      console.error("Failed to load dashboard data:", err);
      document.getElementById("narrativeBox").innerHTML =
        '<p class="state-msg">Data could not be loaded. Check that assets/data/*.json exist.</p>';
    });

  // ---- Last updated badge ----
  function renderLastUpdated(edData, wwData, narrativeData) {
    const dates = [
      edData?.generated,
      wwData?.generated,
      narrativeData?.generated
    ]
      .filter(Boolean)
      .sort();

    const latest = dates.at(-1);

    document.getElementById("lastUpdated").textContent =
      latest ? formatDate(latest) : "unknown";
  }

  // ---- Narrative summary (staff-authored, limited HTML allowed) ----
  const ALLOWED_NARRATIVE_TAGS = ["b", "i", "hr", "br", "strong", "em", "u", "p"];

  function sanitizeNarrativeHtml(raw, allowedTags) {
    allowedTags = allowedTags || ALLOWED_NARRATIVE_TAGS;
    const template = document.createElement("template");
    template.innerHTML = raw;

    function walk(node) {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toLowerCase();
          walk(child);
          if (tag === "script" || tag === "style") {
            child.remove();
          } else if (!allowedTags.includes(tag)) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
          } else {
            Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
          }
        }
      });
    }

    walk(template.content);
    return template.innerHTML;
  }

  function renderNarrative(narrativeData) {
    const box = document.getElementById("narrativeBox");
    if (!narrativeData || !narrativeData.html || !narrativeData.html.trim()) {
      box.innerHTML = '<p class="state-msg">No current situation summary has been posted yet.</p>';
      return;
    }
    box.innerHTML = sanitizeNarrativeHtml(narrativeData.html);
  }



// ---- Shared x-axis (ED weeks + wastewater samples, same range & ticks) ----

  // Return every displayed ED date.
  //
  // Current observations use their actual dates.
  // Prior-year observations retain their source dates in JSON and are
  // shifted forward one calendar year only for display.
  function getEdDatesForAxis(series) {
    const currentPoints = series.points || [];

    return currentPoints.map((p) => p.date);
  }
  
  function computeSharedXAxis(edDates, wwDates) {
    const allDays = [...edDates, ...wwDates].map(dateToEpochDay);
    const min = Math.min(...allDays);
    const max = Math.max(...allDays);
    const span = Math.max(max - min, 1);
    const targetTicks = 6;
    let stepDays = 7;
    while (span / stepDays > targetTicks) stepDays += 7;
    return { min, max, stepSize: stepDays };
  }

  function sharedXScale(shared) {
    return {
      type: "linear",
      min: shared.min,
      max: shared.max,
      ticks: {
        stepSize: shared.stepSize,
        callback: (val, index, ticks) => formatAxisTick(val, index, ticks),
        maxRotation: 0,
        autoSkip: false,
      },
      grid: { display: false },
    };
  }

  // ---- ED chart: linear date axis, current vs. previous year overlaid at same x ----
// ---- ED chart: current observations and calendar-shifted prior year ----
function renderEdChart(key, series, unit, shared) {
  const canvas = document.getElementById(
    `chart-${key}-ed`
  );

  if (!canvas) return;

  const meta = PATHOGEN_META[key];

  const currentPoints = series.points || [];
  const previousPoints = series.previous_points || [];

  const datasets = [
    {
      label: series.current_label || "Current",

      data: currentPoints.map((p) => ({
        x: dateToEpochDay(p.date),
        y: p.value,
        actualDate: p.date,
      })),

      borderColor: meta.strong,
      backgroundColor: hexToRgba(meta.strong, 0.12),
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2.5,
      spanGaps: true,

      // Used by the tooltip filter.
      suppressTooltip: false,
    },
  ];

  if (previousPoints.length) {
    datasets.push({
      label: series.previous_label || "Previous",

      data: previousPoints.map((p) => ({
        // Shift only the displayed x-position.
        x: dateToEpochDay(
          shiftToCurrentYear(p.date)
        ),

        y: p.value,

        // Preserve the unshifted source date if it is ever needed.
        actualDate: p.date,
      })),

      borderColor: meta.soft,
      borderDash: [6, 4],
      fill: false,
      tension: 0.3,
      pointRadius: 0,

      // The comparison line is visual context, not interactive data.
      pointHoverRadius: 0,

      borderWidth: 2,
      spanGaps: true,

      isPriorYear: true,
      suppressTooltip: true,
    });
  }

  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      datasets,
    },
    options: baseLineOptions(unit, shared),
  });
}

  
  // ---- Influenza wastewater charts ----
  // Influenza A and B are intentionally displayed as separate charts.
  // Each Chart instance receives its own y-axis, while both charts use
  // the same shared date scale as the influenza ED chart.
  function renderInfluenzaWastewaterCharts(
    fluASeries,
    fluBSeries,
    unit,
    shared
  ) {
    const originalCanvas = document.getElementById(
      "chart-influenza-ww"
    );

    if (!originalCanvas) return;

    const container = originalCanvas.parentElement;

    // Remove the single-chart layout applied by .chart-wrap.
    container.className = "flu-wastewater-grid";

    container.innerHTML = `
      <section class="flu-wastewater-panel">
        <h4 class="flu-wastewater-title">
          Influenza A
        </h4>
        <div class="flu-wastewater-canvas-wrap">
          <canvas
            id="chart-flua-ww"
            aria-label="Influenza A wastewater trend"
            role="img"
          ></canvas>
        </div>
      </section>

      <section class="flu-wastewater-panel">
        <h4 class="flu-wastewater-title">
          Influenza B
        </h4>
        <div class="flu-wastewater-canvas-wrap">
          <canvas
            id="chart-flub-ww"
            aria-label="Influenza B wastewater trend"
            role="img"
          ></canvas>
        </div>
      </section>
    `;

    renderWastewaterChart(
      "flua",
      fluASeries,
      unit,
      shared,
      "chart-flua-ww",
      PATHOGEN_META.influenza
    );

    renderWastewaterChart(
      "flub",
      fluBSeries,
      unit,
      shared,
      "chart-flub-ww",
      PATHOGEN_META.influenza
    );
  }
  
  // ---- Wastewater chart: same shared date axis, irregular sample spacing.
  //      Optionally overlays a prior-year series (previous_points), same
  //      visual convention as ED (solid = current, dashed = prior year). ----
  function renderWastewaterChart(
    key,
    series,
    unit,
    shared,
    canvasId,
    metaOverride
  ) {
    const resolvedCanvasId =
      canvasId || `chart-${key}-ww`;

    const canvas = document.getElementById(
      resolvedCanvasId
    );

    if (!canvas) return;

    const meta =
      metaOverride ||
      PATHOGEN_META[key];

    const currentPoints = series.points || [];
    const previousPoints =
      series.previous_points || [];

    const datasets = [
      {
        label:
          series.current_label ||
          series.label ||
          meta.label,
        data: currentPoints.map((p) => ({
          x: dateToEpochDay(p.date),
          y: p.value,
          actualDate: p.date,
        })),
        borderColor: meta.strong,
        backgroundColor: hexToRgba(
          meta.strong,
          0.15
        ),
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2.5,
        spanGaps: true,
      },
    ];

    if (previousPoints.length) {
      datasets.push({
        label:
          series.previous_label ||
          `${series.label || meta.label}, prior year`,
        data: previousPoints.map((p) => ({
          x: dateToEpochDay(
            shiftToCurrentYear(p.date)
          ),
          y: p.value,
          actualDate: p.date,
        })),
        borderColor: meta.soft,
        borderDash: [6, 4],
        fill: false,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 0,
        borderWidth: 2,
        spanGaps: true,
        isPriorYear: true,
        suppressTooltip: true,
      });
    }

    new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { datasets },
      options: baseLineOptions(unit, shared),
    });
  }

  // Shared by BOTH chart types â€” both use the same linear epoch-day x-axis,
  // so the tooltip title is always derived from that axis via formatEpochDay.
  // (Previously this was conditional on a `titleFromEpoch` flag that was only
  // passed for the wastewater chart, which is why ED tooltips were showing
  // the raw epoch-day number, e.g. "20,352", instead of a date.)
  function baseLineOptions(unit, shared) {
    return {
      responsive: true,
      maintainAspectRatio: false,

      interaction: {
        mode: "nearest",
        axis: "x",
        intersect: false,
      },

      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 14,
            boxHeight: 3,
            padding: 14,
          },
        },

        tooltip: {
          backgroundColor: "#26292c",
          padding: 10,
          cornerRadius: 8,

          filter: (item) =>
            item.dataset.suppressTooltip !== true,

          callbacks: {
            title: (items) => {
              if (!items.length) return "";

              return formatFullEpochDay(
                items[0].parsed.x
              );
            },

            label: (item) => {
              return `${item.dataset.label}: ${item.parsed.y}`;
            },
          },
        },
      },

      scales: {
        x: sharedXScale(shared),

        y: {
          beginAtZero: true,
          grid: {
            color: "#e2e6e9",
          },
          title: {
            display: !!unit,
            text: unit,
            font: {
              size: 10,
            },
          },
        },
      },
    };
  }

  // ---- helpers ----
  function findPathogen(list, key) {
    return (list || []).find((p) => p.key === key);
  }
  function dateToEpochDay(dateOrStr) {
    const ms =
      typeof dateOrStr === "string"
        ? new Date(dateOrStr + "T00:00:00").getTime()
        : dateOrStr.getTime();
    return Math.floor(ms / 86400000);
  }
  function shiftToCurrentYear(dateStr, years) {
    years = years || 1;
    const d = new Date(dateStr + "T00:00:00");
    d.setFullYear(d.getFullYear() + years);
    return d;
  }
  function formatEpochDay(epochDay) {
    const d = new Date(epochDay * 86400000);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  function formatFullEpochDay(epochDay) {
    const d = new Date(epochDay * 86400000);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  function formatAxisTick(epochDay, index, ticks) {
    const d = new Date(epochDay * 86400000);
    const year = d.getUTCFullYear();
    const previousYear = index > 0
      ? new Date(ticks[index - 1].value * 86400000).getUTCFullYear()
      : null;
    const showYear = index === 0 || year !== previousYear;

    // Chart.js renders array values on separate lines, creating a compact
    // second tier for the year without changing the shared tick positions.
    return [formatEpochDay(epochDay), showYear ? String(year) : ""];
  }
  function formatDate(dateString) {
    const dateOnly = dateString.split("T")[0];
    const [year, month, day] = dateOnly.split("-").map(Number);

    const date = new Date(year, month - 1, day);

    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }
})();
