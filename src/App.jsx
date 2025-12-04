/*
Deep-FLC React Demo (fixed)
----------------------------
This single-file React app demonstrates a simplified implementation of the Deep-FLC
(Deep Fuzzy Logic Controller) algorithm for energy management. It contains:

- A compact fuzzy logic engine (triangular membership functions)
- A generated 3x3x3x3 rule-base (81 rules)
- A simple "LSTM-like" predictor (moving-average placeholder) to emulate forecasts
- Interactive dashboard: inputs for SOC, SOH, Load, Temperature
- Charts (using recharts) to visualize SOC, SOH, Load, Temperature, CP, GP over time
- Rule base displayed as a table (81 rules)

Notes:
- This demo is meant for research/education and to integrate into your thesis.
- Replace the predictor placeholder with a real LSTM backend or TF.js model for production.

How to run:
1. Create a React app (Vite or CRA). Install dependencies:
   npm install recharts
2. Paste this file content into src/App.jsx (or adapt as multiple files).
3. Run the app: npm run dev / npm start

Styling uses Tailwind-class-like names; you can use plain CSS.
*/

import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Label,
  ResponsiveContainer,
} from "recharts";

// ------------------------
// Utilities: triangular MF
// ------------------------
function triMF(x, a, b, c) {
  if (b === a) {
    // left-shoulder
    if (x <= a) return 1;
    if (x >= c) return 0;
    return (c - x) / (c - a);
  }
  if (b === c) {
    // right-shoulder
    if (x <= a) return 0;
    if (x >= c) return 1;
    return (x - a) / (b - a);
  }
  if (x <= a) return 0;
  if (x >= c) return 0;
  if (x === b) return 1;
  if (x > a && x < b) return (x - a) / (b - a);
  if (x > b && x < c) return (c - x) / (c - b);
  return 0;
}

// ------------------------
// Membership functions for inputs
// all inputs normalized 0..100
// ------------------------
const mfDefs = {
  SOC: {
    Low: [0, 0, 60],
    Medium: [50, 75, 90],
    High: [80, 100, 100],
  },
  SOH: {
    Degraded: [0, 0, 60],
    Normal: [50, 75, 90],
    Good: [80, 100, 100],
  },
  Load: {
    Low: [0, 0, 40],
    Medium: [30, 50, 70],
    High: [60, 100, 100],
  },
  Temperature: {
    Low: [0, 0, 20],
    Normal: [15, 30, 45],
    High: [40, 70, 100],
  },
};

function fuzzifyInput(name, x) {
  const defs = mfDefs[name];
  const out = {};
  Object.keys(defs).forEach((term) => {
    const [a, b, c] = defs[term];
    out[term] = triMF(x, a, b, c);
  });
  return out;
}

// ------------------------
// Rule base generator (81 rules)
// ------------------------
const SOC_TERMS = ["Low", "Medium", "High"];
const SOH_TERMS = ["Degraded", "Normal", "Good"];
const LOAD_TERMS = ["Low", "Medium", "High"];
const TEMP_TERMS = ["Low", "Normal", "High"];

const OUTPUT_CENTROIDS = { Low: 25, Medium: 50, High: 75 };

function generateRuleBase() {
  const rules = [];
  let id = 1;
  for (let si = 0; si < SOC_TERMS.length; si++) {
    for (let qi = 0; qi < SOH_TERMS.length; qi++) {
      for (let li = 0; li < LOAD_TERMS.length; li++) {
        for (let ti = 0; ti < TEMP_TERMS.length; ti++) {
          const SOCterm = SOC_TERMS[si];
          const SOHterm = SOH_TERMS[qi];
          const LOADterm = LOAD_TERMS[li];
          const TEMPterm = TEMP_TERMS[ti];

          let CP = "Medium";
          let GP = "Medium";

          if (SOCterm === "Low") {
            CP = "Low";
            GP = "High";
          } else if (SOCterm === "Medium") {
            CP = "Medium";
            GP = "Medium";
          } else {
            CP = "High";
            GP = "Low";
          }

          if (SOHterm === "Degraded") {
            if (CP === "High") CP = "Medium";
            else if (CP === "Medium") CP = "Low";
            if (GP === "Low") GP = "Medium";
            else if (GP === "Medium") GP = "High";
          }

          if (LOADterm === "High") {
            if (CP === "High") CP = "Medium";
            else if (CP === "Medium") CP = "Low";
            if (GP === "Low") GP = "Medium";
            else if (GP === "Medium") GP = "High";
          }

          if (TEMPterm === "High") {
            if (CP === "High") CP = "Medium";
            else if (CP === "Medium") CP = "Low";
            if (GP === "Low") GP = "Medium";
            else if (GP === "Medium") GP = "High";
          }

          rules.push({
            id: id++,
            antecedent: { SOC: SOCterm, SOH: SOHterm, Load: LOADterm, Temp: TEMPterm },
            consequent: { CP, GP },
          });
        }
      }
    }
  }
  return rules;
}

const RULE_BASE = generateRuleBase();

// ------------------------
// Fuzzy inference (Mamdani-style simplified)
// ------------------------
function inferFuzzy(SOC, SOH, Load, Temp) {
  const fSOC = fuzzifyInput("SOC", SOC);
  const fSOH = fuzzifyInput("SOH", SOH);
  const fLoad = fuzzifyInput("Load", Load);
  const fTemp = fuzzifyInput("Temperature", Temp);

  let cpNumer = 0;
  let cpDenom = 0;
  let gpNumer = 0;
  let gpDenom = 0;

  for (const r of RULE_BASE) {
    const a1 = fSOC[r.antecedent.SOC] || 0;
    const a2 = fSOH[r.antecedent.SOH] || 0;
    const a3 = fLoad[r.antecedent.Load] || 0;
    const a4 = fTemp[r.antecedent.Temp] || 0;
    const firing = Math.min(a1, a2, a3, a4);
    if (firing <= 0) continue;
    const cpCent = OUTPUT_CENTROIDS[r.consequent.CP];
    const gpCent = OUTPUT_CENTROIDS[r.consequent.GP];
    cpNumer += firing * cpCent;
    cpDenom += firing;
    gpNumer += firing * gpCent;
    gpDenom += firing;
  }

  const CP = cpDenom > 0 ? cpNumer / cpDenom : 50;
  const GP = gpDenom > 0 ? gpNumer / gpDenom : 50;

  return { CP, GP, memberships: { fSOC, fSOH, fLoad, fTemp } };
}

// ------------------------
// Simple predictor (placeholder for LSTM)
// ------------------------
function predictSeries(history, steps = 1) {
  if (!history || history.length === 0) return Array(steps).fill(50);
  const alpha = 0.2;
  let last = history[history.length - 1];
  for (let i = history.length - 2; i >= 0; i--) {
    last = alpha * history[i] + (1 - alpha) * last;
  }
  return Array.from({ length: steps }, () => Math.max(0, Math.min(100, last)));
}

// ------------------------
// Rule table component
// ------------------------
function RuleTable({ rules }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="min-w-full border border-gray-300 text-sm">
        <thead>
          <tr>
            <th className="border px-2 py-1">#</th>
            <th className="border px-2 py-1">SOC</th>
            <th className="border px-2 py-1">SOH</th>
            <th className="border px-2 py-1">Load</th>
            <th className="border px-2 py-1">Temp</th>
            <th className="border px-2 py-1">CP</th>
            <th className="border px-2 py-1">GP</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td className="border px-2 py-1">{r.id}</td>
              <td className="border px-2 py-1">{r.antecedent.SOC}</td>
              <td className="border px-2 py-1">{r.antecedent.SOH}</td>
              <td className="border px-2 py-1">{r.antecedent.Load}</td>
              <td className="border px-2 py-1">{r.antecedent.Temp}</td>
              <td className="border px-2 py-1">{r.consequent.CP}</td>
              <td className="border px-2 py-1">{r.consequent.GP}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------
// React App UI
// ------------------------
export default function App() {
  const [soc, setSoc] = useState(50);
  const [soh, setSoh] = useState(100);
  const [load, setLoad] = useState(50);
  const [temp, setTemp] = useState(25);

  const [time, setTime] = useState(0);
  const [series, setSeries] = useState([]);
  const [mode, setMode] = useState("deep");
  const [running, setRunning] = useState(false);

  const [socHist, setSocHist] = useState([50]);
  const [sohHist, setSohHist] = useState([100]);
  const [loadHist, setLoadHist] = useState([50]);
  const [tempHist, setTempHist] = useState([25]);

  useEffect(() => {
    let timer;
    if (running) {
      timer = setInterval(() => stepOnce(), 1000);
    }
    return () => clearInterval(timer);
  }, [running, soc, soh, load, temp, mode]);

  function stepOnce() {
    const t = time + 1;

    let useSOC = soc;
    let useSOH = soh;
    let useTemp = temp;
    let useLoad = load;

    if (mode === "deep") {
      useSOC = predictSeries(socHist, 1)[0];
      useSOH = predictSeries(sohHist, 1)[0];
      useTemp = predictSeries(tempHist, 1)[0];
      useLoad = predictSeries(loadHist, 1)[0];
    }

    const inference = inferFuzzy(useSOC, useSOH, useLoad, useTemp);
    const CP = inference.CP;
    const GP = inference.GP;

    const batteryCapacityKWh = 16.2; // demo parameter
    const pvToBat = 200; // simplified constant
    const batToLoad = Math.max(0, useLoad - 100) * 0.1;

    const deltaSOC = (pvToBat - batToLoad) / (batteryCapacityKWh * 1000) * 100 * 0.9;
    const newSOC = Math.max(0, Math.min(100, soc + deltaSOC));
    const newTemp = Math.max(0, Math.min(100, temp + 0.01 * useLoad));
    const newSOH = Math.max(40, soh - 0.005);

    const point = {
      time: t,
      SOC: Math.round(newSOC * 100) / 100,
      SOH: Math.round(newSOH * 100) / 100,
      Load: Math.round(useLoad * 100) / 100,
      Temperature: Math.round(newTemp * 100) / 100,
      CP: Math.round(CP * 100) / 100,
      GP: Math.round(GP * 100) / 100,
      mode,
    };

    setTime(t);
    setSeries((s) => [...s.slice(-199), point]);
    setSoc(newSOC);
    setTemp(newTemp);
    setSoh(newSOH);

    setSocHist((h) => [...h.slice(-199), newSOC]);
    setSohHist((h) => [...h.slice(-199), newSOH]);
    setLoadHist((h) => [...h.slice(-199), load]);
    setTempHist((h) => [...h.slice(-199), newTemp]);
  }

  function resetSimulation() {
    setTime(0);
    setSeries([]);
    setSoc(50);
    setSoh(100);
    setLoad(50);
    setTemp(25);
    setSocHist([50]);
    setSohHist([100]);
    setLoadHist([50]);
    setTempHist([25]);
    setRunning(false);
  }

  const lastPoint = series.length ? series[series.length - 1] : null;

  return (
    <div className="p-4 font-sans w-full">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Deep-FLC </h1>
       
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="col-span-1 bg-white p-4 rounded shadow">
          <h2 className="font-semibold mb-2">Controls</h2>

          <label className="block text-xs">SOC: {Math.round(soc)}</label>
          <input type="range" min="0" max="100" value={soc} onChange={(e) => setSoc(Number(e.target.value))} />

          <label className="block text-xs">SOH: {Math.round(soh)}</label>
          <input type="range" min="0" max="100" value={soh} onChange={(e) => setSoh(Number(e.target.value))} />

          <label className="block text-xs">Load: {Math.round(load)}</label>
          <input type="range" min="0" max="100" value={load} onChange={(e) => setLoad(Number(e.target.value))} />

          <label className="block text-xs">Temperature: {Math.round(temp)}</label>
          <input type="range" min="0" max="100" value={temp} onChange={(e) => setTemp(Number(e.target.value))} />

          <div className="mt-3">
            <label className="mr-2">Mode:</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="conventional">Conventional</option>
              <option value="flc">FLC</option>
              <option value="deep">Deep-FLC</option>
            </select>
          </div>

          <div className="mt-3 flex gap-2">
            <button onClick={() => setRunning((r) => !r)} className="px-3 py-1 bg-blue text-black rounded">
              {running ? "Pause" : "Start"}
            </button>
            <button onClick={stepOnce} className="px-3 py-1 bg-gray-200 rounded">
              Step
            </button>
            <button onClick={resetSimulation} className="px-3 py-1 bg-red-400 text-black rounded">
              Reset
            </button>
          </div>

          <div className="mt-4 text-xs text-gray-700">
            <div>Last CP: {lastPoint ? lastPoint.CP : "-"}</div>
            <div>Last GP: {lastPoint ? lastPoint.GP : "-"}</div>
            <div>Last SOC: {lastPoint ? lastPoint.SOC : Math.round(soc)}</div>
            <div>Last Temp: {lastPoint ? lastPoint.Temperature : Math.round(temp)}</div>
          </div>
        </div>

        <div className="col-span-2 bg-white p-4 rounded shadow">
          <h2 className="font-semibold mb-2">Charts</h2>

          <div style={{ width: "100%", height: 240 }}>
  <ResponsiveContainer>
    <LineChart data={series}>
      <CartesianGrid stroke="#eee" strokeDasharray="5 5" />
      <XAxis dataKey="time">
        <Label value="Time (s)" offset={-5} position="insideBottom" />
      </XAxis>
      <YAxis>
        <Label value="Value (%)" angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
      </YAxis>
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="SOC" stroke="#8884d8" dot={false} />
      <Line type="monotone" dataKey="SOH" stroke="#82ca9d" dot={false} />
      <Line type="monotone" dataKey="Load" stroke="#ff7300" dot={false} />
      <Line type="monotone" dataKey="Temperature" stroke="#ff0000" dot={false} />
    </LineChart>
  </ResponsiveContainer>
</div>

<div className="mt-4" style={{ width: "100%", height: 200 }}>
  <ResponsiveContainer>
    <LineChart data={series}>
      <CartesianGrid stroke="#eee" strokeDasharray="5 5" />
      <XAxis dataKey="time">
        <Label value="Time (s)" offset={-5} position="insideBottom" />
      </XAxis>
      <YAxis>
        <Label value="Power / Control (%)" angle={-90} position="insideLeft" style={{ textAnchor: 'middle' }} />
      </YAxis>
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="CP" stroke="#0033cc" dot={false} />
      <Line type="monotone" dataKey="GP" stroke="#cc0033" dot={false} />
    </LineChart>
  </ResponsiveContainer>
</div>
        </div>
      </div>

      <div className="mt-6 bg-white p-4 rounded shadow">
        <h2 className="font-semibold mb-2">Fuzzy Debug / Rule firing (top rules)</h2>
        <div className="text-xs">
          <div>Memberships (SOC):</div>
          <pre>{JSON.stringify(lastPoint ? fuzzifyInput("SOC", lastPoint.SOC) : fuzzifyInput("SOC", soc), null, 2)}</pre>
        </div>

        <div className="mt-2 text-xs">
          <div>Rule base size: {RULE_BASE.length}</div>
          <div>Rules (table):</div>
          <RuleTable rules={RULE_BASE} />
        </div>
      </div>
    </div>
  );
}
