import React, { useEffect, useState, useMemo } from "react";
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

function triMF(x, a, b, c) {
  if (b === a) {
    if (x <= a) return 1;
    if (x >= c) return 0;
    return (c - x) / (c - a);
  }
  if (b === c) {
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

const defaultMFs = {
  SOC: { Low: [0, 0, 60], Medium: [50, 75, 90], High: [80, 100, 100] },
  SOH: { Degraded: [0, 0, 60], Normal: [50, 75, 90], Good: [80, 100, 100] },
  Load: { Low: [0, 0, 40], Medium: [30, 50, 70], High: [60, 100, 100] },
  Temperature: { Low: [0, 0, 20], Normal: [15, 30, 45], High: [40, 100, 100] },
};

const SOC_TERMS = ["Low", "Medium", "High"];
const SOH_TERMS = ["Degraded", "Normal", "Good"];
const LOAD_TERMS = ["Low", "Medium", "High"];
const TEMP_TERMS = ["Low", "Normal", "High"];
const OUTPUT_CENTROIDS = { Low: 25, Medium: 50, High: 75 };

function App() {
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
  const [mfDefs, setMfDefs] = useState(defaultMFs);
  const [energySeries, setEnergySeries] = useState([]);
  const [electricityRate, setElectricityRate] = useState(5);

  const updateMF = (variable, term, index, value) => {
    setMfDefs((prev) => ({
      ...prev,
      [variable]: {
        ...prev[variable],
        [term]: prev[variable][term].map((v, i) =>
          i === index ? Number(value) : v
        ),
      },
    }));
  };

  const fuzzifyInput = (name, x) => {
    const defs = mfDefs[name];
    const out = {};
    Object.keys(defs).forEach((term) => {
      const [a, b, c] = defs[term];
      out[term] = triMF(x, a, b, c);
    });
    return out;
  };

  // Генерування правил залежно від mfDefs
  const RULE_BASE = useMemo(() => {
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
  }, []);

  const inferFuzzy = (SOC, SOH, Load, Temp) => {
    const fSOC = fuzzifyInput("SOC", SOC);
    const fSOH = fuzzifyInput("SOH", SOH);
    const fLoad = fuzzifyInput("Load", Load);
    const fTemp = fuzzifyInput("Temperature", Temp);

    let cpNumer = 0,
      cpDenom = 0,
      gpNumer = 0,
      gpDenom = 0;

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
  };

  const predictSeries = (history, steps = 1) => {
    if (!history || history.length === 0) return Array(steps).fill(50);
    const alpha = 0.2;
    let last = history[history.length - 1];
    for (let i = history.length - 2; i >= 0; i--) {
      last = alpha * history[i] + (1 - alpha) * last;
    }
    return Array.from({ length: steps }, () =>
      Math.max(0, Math.min(100, last))
    );
  };

  useEffect(() => {
    let timer;
    if (running) timer = setInterval(stepOnce, 1000);
    return () => clearInterval(timer);
  }, [running, soc, soh, load, temp, mode, mfDefs]);

  function stepOnce() {
    const t = time + 1;
    let useSOC = soc,
      useSOH = soh,
      useLoad = load,
      useTemp = temp;

    if (mode === "deep") {
      useSOC = predictSeries(socHist, 1)[0];
      useSOH = predictSeries(sohHist, 1)[0];
      useLoad = predictSeries(loadHist, 1)[0];
      useTemp = predictSeries(tempHist, 1)[0];
    }

    const inference = inferFuzzy(useSOC, useSOH, useLoad, useTemp);
    let CP = inference.CP;
    let GP = inference.GP;

    if (useTemp > 60) { CP = Math.max(CP - 10, 20); GP = Math.min(GP + 10, 80); }
    if (useSOH < 50) { CP = Math.max(CP - 15, 15); GP = Math.min(GP + 15, 85); }
    if (useLoad > 80) { CP = Math.min(CP + 10, 75); }

    const batteryCapacityKWh = 16.2;
    const pvToBat = 200;
    const batToLoad = Math.max(0, useLoad - 100) * 0.1;
    const deltaSOC = ((pvToBat - batToLoad) / (batteryCapacityKWh * 1000)) * 100 * 0.9;
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
    setLoadHist((h) => [...h.slice(-199), useLoad]);
    setTempHist((h) => [...h.slice(-199), newTemp]);

    // ---- Додатково: розрахунок кумулятивної енергії ----
    const deltaT = 1; // секунда
    const loadPower = (useLoad / 100) * 5 * 1000; // Вт, Load 0-100% = 0-5 кВт
    const powerFromGrid = 200; // Вт
    const batToLoadPower = Math.max(0, loadPower - 1000); // Вт

    const lastEnergy = energySeries.length ? energySeries[energySeries.length - 1].energy : 0;
    const newEnergy = lastEnergy + (powerFromGrid + batToLoadPower) * deltaT / 3600000; // кВт·год

    setEnergySeries((s) => [...s.slice(-199), { time: t, energy: newEnergy }]);
  }

  const MFChart = ({ variable, terms, mfDefs }) => {
    const data = useMemo(() => {
      const chartData = [];
      for (let x = 0; x <= 100; x += 1) {
        const point = { x };
        terms.forEach((term) => {
          const [a, b, c] = mfDefs[variable][term];
          point[term] = triMF(x, a, b, c);
        });
        chartData.push(point);
      }
      return chartData;
    }, [variable, terms, mfDefs]);

    const colors = ["#8884d8", "#82ca9d", "#ff7300"];

    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" />
          <YAxis />
          <Tooltip />
          <Legend />
          {terms.map((term, i) => (
            <Line
              key={term}
              type="monotone"
              dataKey={term}
              stroke={colors[i]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  };

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

  // Розрахунок вартості споживання
  const calculateEnergyCost = () => {
    const deltaT = 1; // крок симуляції в секундах (як у stepOnce)
    const batteryCapacityKWh = 16.2; // ємність батареї
    let totalEnergy = 0; // кВт·год

    for (let i = 1; i < series.length; i++) {
      const loadPercent = series[i].Load; // 0-100%

      // Потужність навантаження (приблизно 0-5 кВт)
      const loadPower = (loadPercent / 100) * 5 * 1000; // Вт

      // Від мережі забирається 200 Вт для заряду батареї
      const powerFromGrid = 200; // Вт

      // Потужність, яку батарея віддає на навантаження
      const batToLoad = Math.max(0, loadPower - 1000); // 1000 Вт – умовна власна генерація/покриття

      // Загальна енергія за крок Δt: (Вт * сек) / 3600000 = кВт·год
      totalEnergy += (powerFromGrid + batToLoad) * deltaT / 3600000;
    }

    const cost = totalEnergy * electricityRate;
    return { totalEnergy: totalEnergy.toFixed(4), cost: cost.toFixed(2) };
  };


  const energyCost = calculateEnergyCost();

  const RuleTable = ({ rules }) => (
    <table className="border-collapse border border-gray-400 w-full text-sm">
      <thead>
        <tr className="bg-gray-200">
          <th className="border border-gray-400 px-2 py-1">#</th>
          <th className="border border-gray-400 px-2 py-1">SOC</th>
          <th className="border border-gray-400 px-2 py-1">SOH</th>
          <th className="border border-gray-400 px-2 py-1">Load</th>
          <th className="border border-gray-400 px-2 py-1">Temp</th>
          <th className="border border-gray-400 px-2 py-1">CP</th>
          <th className="border border-gray-400 px-2 py-1">GP</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.id}>
            <td className="border border-gray-400 px-2 py-1">{r.id}</td>
            <td className="border border-gray-400 px-2 py-1">{r.antecedent.SOC}</td>
            <td className="border border-gray-400 px-2 py-1">{r.antecedent.SOH}</td>
            <td className="border border-gray-400 px-2 py-1">{r.antecedent.Load}</td>
            <td className="border border-gray-400 px-2 py-1">{r.antecedent.Temp}</td>
            <td className="border border-gray-400 px-2 py-1">{r.consequent.CP}</td>
            <td className="border border-gray-400 px-2 py-1">{r.consequent.GP}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="p-4 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Deep-FLC</h1>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">Controls</h2>
          <div className="space-y-2">
            <div>
              <label>SOC: {Math.round(soc)}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={soc}
                onChange={(e) => setSoc(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label>SOH: {Math.round(soh)}</label>
              <input
                type="range"
                min="40"
                max="100"
                value={soh}
                onChange={(e) => setSoh(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label>Load: {Math.round(load)}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={load}
                onChange={(e) => setLoad(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label>Temperature: {Math.round(temp)}</label>
              <input
                type="range"
                min="0"
                max="100"
                value={temp}
                onChange={(e) => setTemp(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block font-semibold mb-2">Mode:</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="border rounded px-2 py-1 w-full"
            >
              <option value="conventional">Conventional FLC</option>
              <option value="deep">Deep-FLC</option>
            </select>
          </div>

          <div className="mt-4 space-x-2">
            <button
              onClick={() => setRunning((r) => !r)}
              className="px-3 py-1 bg-blue-500 text-black rounded"
            >
              {running ? "Pause" : "Start"}
            </button>
            <button
              onClick={resetSimulation}
              className="px-3 py-1 bg-gray-500 text-black rounded"
            >
              Reset
            </button>
          </div>

          <div className="my-4 bg-blue-100 p-2 rounded">
            <p>Last CP: {lastPoint ? lastPoint.CP : "-"}</p>
            <p>Last GP: {lastPoint ? lastPoint.GP : "-"}</p>
            <p>Last SOC: {lastPoint ? lastPoint.SOC : Math.round(soc)}</p>
            <p>Last Temp: {lastPoint ? lastPoint.Temperature : Math.round(temp)}</p>
          </div>
          <div className="bg-white p-4 rounded shadow">
            <h2 className="font-bold mb-3">Energy Settings</h2>
            <div>
              <label className="block text-sm font-semibold mb-2">
                Electricity Rate (грн/кВтч): {electricityRate.toFixed(2)}
              </label>
              <input
                type="range"
                min="0.5"
                max="20"
                step="0.1"
                value={electricityRate}
                onChange={(e) => setElectricityRate(Number(e.target.value))}
                className="w-full"
              />
              <input
                type="number"
                min="0.5"
                max="20"
                step="0.1"
                value={electricityRate}
                onChange={(e) => setElectricityRate(Number(e.target.value))}
                className="border px-2 py-1 w-full mt-2"
              />
            </div>
          </div>
          <div className="my-4 bg-white p-4 rounded shadow">
            <h2 className="font-bold mb-3">Cumulative Energy Consumption (кВт·год)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={energySeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="energy" stroke="#ff7300" dot={false} name="Energy (кВт·год)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">Edit Membership Functions</h2>
          <div className="flex w-full gap-2">
            {Object.keys(mfDefs).map((variable) => (
              <div key={variable} className="border p-2 rounded w-full h-fit mb-4">
                <p className="font-semibold">{variable}</p>
                {Object.keys(mfDefs[variable]).map((term) => (
                  <div key={term} className="text-sm mt-1 ">
                    <p className="mb-2">{term}:</p>
                    <div className="flex gap-2">
                      {mfDefs[variable][term].map((val, i) => (
                        <input
                          key={i}

                          min="0"
                          max="100"
                          value={val}
                          onChange={(e) => updateMF(variable, term, i, e.target.value)}
                          className="border w-full text-center text-xs outline-none"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold mb-3">SOC Membership Functions</h2>
              <MFChart variable="SOC" terms={SOC_TERMS} mfDefs={mfDefs} />
            </div>
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold mb-3">SOH Membership Functions</h2>
              <MFChart variable="SOH" terms={SOH_TERMS} mfDefs={mfDefs} />
            </div>
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold mb-3">Load Membership Functions</h2>
              <MFChart variable="Load" terms={LOAD_TERMS} mfDefs={mfDefs} />
            </div>
            <div className="bg-white p-4 rounded shadow">
              <h2 className="font-bold mb-3">Temperature Membership Functions</h2>
              <MFChart
                variable="Temperature"
                terms={TEMP_TERMS}
                mfDefs={mfDefs}
              />
            </div>
          </div>
        </div>


      </div>

      <div className="mb-4 bg-white p-4 rounded shadow">
        <h2 className="font-bold mb-3">Main Chart (CP, GP)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="CP" stroke="#8884d8" dot={false} />
            <Line type="monotone" dataKey="GP" stroke="#82ca9d" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-4 bg-white p-4 rounded shadow">
        <h2 className="font-bold mb-3">System Parameters (SOC, SOH, Load, Temperature)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="SOC" stroke="#ff7300" dot={false} />
            <Line type="monotone" dataKey="SOH" stroke="#8b0000" dot={false} />
            <Line type="monotone" dataKey="Load" stroke="#0000ff" dot={false} />
            <Line type="monotone" dataKey="Temperature" stroke="#ff0000" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">Energy Consumption Analysis</h2>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Total Energy Consumed:</span>
              <span className="font-semibold">{energyCost.totalEnergy} кВтч</span>
            </div>
            <div className="flex justify-between">
              <span>Electricity Rate:</span>
              <span className="font-semibold">{electricityRate.toFixed(2)} грн/кВтч</span>
            </div>
            <div className="flex justify-between text-lg border-t pt-2 mt-2">
              <span>Total Cost:</span>
              <span className="font-bold text-green-600">{energyCost.cost} грн</span>
            </div>
            <div className="flex justify-between">
              <span>Simulation Steps:</span>
              <span className="font-semibold">{series.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Average Load:</span>
              <span className="font-semibold">
                {series.length > 0
                  ? (
                    series.reduce((acc, p) => acc + p.Load, 0) / series.length
                  ).toFixed(2)
                  : "-"}{" "}
                %
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded shadow">
          <h2 className="font-bold mb-3">System Status Summary</h2>
          <div className="space-y-2">
            <div>
              <p className="text-sm text-gray-600">Current SOC</p>
              <p className="text-2xl font-bold">{lastPoint ? lastPoint.SOC : Math.round(soc)}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Current SOH</p>
              <p className="text-2xl font-bold">{lastPoint ? lastPoint.SOH : Math.round(soh)}%</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t">
              <div>
                <p className="text-xs text-gray-600">Current Load</p>
                <p className="font-semibold">{lastPoint ? lastPoint.Load : Math.round(load)}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">Current Temp</p>
                <p className="font-semibold">{lastPoint ? lastPoint.Temperature : Math.round(temp)}°</p>
              </div>
            </div>
          </div>
        </div>


      </div>



      <div className="bg-white p-4 rounded shadow mb-4">
        <h2 className="font-bold mb-3">Rule Base</h2>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <RuleTable rules={RULE_BASE} />
        </div>
      </div>
    </div>
  );
}

export default App;