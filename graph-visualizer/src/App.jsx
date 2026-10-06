import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Activity, Play, StepForward, RotateCcw, Volume2, VolumeX, Info, Plus, Trash2, MousePointer2, GitCommit } from 'lucide-react';

const defaultNodes = [
  { id: 'A', x: 300, y: 150 },
  { id: 'B', x: 550, y: 300 },
  { id: 'C', x: 300, y: 450 },
  { id: 'D', x: 150, y: 300 },
  { id: 'E', x: 550, y: 450 },
];

const defaultEdges = [
  { id: 'e1', from: 'A', to: 'B', weight: 2 },
  { id: 'e2', from: 'B', to: 'C', weight: -2 },
  { id: 'e3', from: 'C', to: 'D', weight: 1 },
  { id: 'e4', from: 'D', to: 'B', weight: -2 }, // Cycle
  { id: 'e5', from: 'A', to: 'D', weight: 5 },
  { id: 'e6', from: 'C', to: 'E', weight: 4 },
];

export default function App() {
  const [nodes, setNodes] = useState(defaultNodes);
  const [edges, setEdges] = useState(defaultEdges);
  const [startNode, setStartNode] = useState('A');
  
  // Editor State
  const [editorMode, setEditorMode] = useState('VIEW'); 
  const [newEdgeStart, setNewEdgeStart] = useState(null);

  // Simulation State
  const [speed, setSpeed] = useState(1);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [phase, setPhase] = useState('IDLE'); 
  const [sim, setSim] = useState({
    distances: {}, queue: [], activeNode: null, activeEdge: null, highlightedCycle: [],
    logTitle: 'SYSTEM READY', logMsg: 'Click Play to begin pathfinding simulation.'
  });

  const abortControllerRef = useRef(null);
  const voiceRef = useRef(voiceEnabled);
  useEffect(() => { voiceRef.current = voiceEnabled; }, [voiceEnabled]);

  // --- Initialize ---
  useEffect(() => {
    if (phase === 'IDLE') {
      const initDist = {};
      nodes.forEach(n => initDist[n.id] = n.id === startNode ? 0 : Infinity);
      setSim(s => ({ ...s, distances: initDist, queue: [], activeNode: null, activeEdge: null, highlightedCycle: [], logTitle: 'DIJKSTRA SIMULATION LOG', logMsg: `Initialized. Source ${startNode} distance set to 0.` }));
    }
  }, [startNode, nodes, edges, phase]);

  // --- Dynamic ViewBox Calculation ---
  const viewBox = useMemo(() => {
    if (nodes.length === 0) return "0 0 800 600";
    const paddingX = 120, paddingTop = 150, paddingBottom = 120;
    const minX = Math.min(...nodes.map(n => n.x)) - paddingX;
    const maxX = Math.max(...nodes.map(n => n.x)) + paddingX;
    const minY = Math.min(...nodes.map(n => n.y)) - paddingTop;
    const maxY = Math.max(...nodes.map(n => n.y)) + paddingBottom;
    return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
  }, [nodes]);

  // --- Helpers ---
  const speak = (text) => new Promise(res => {
    if (!window.speechSynthesis || !voiceRef.current || abortControllerRef.current?.signal.aborted) return res();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.onend = res; utterance.onerror = res;
    window.speechSynthesis.speak(utterance);
  });

  const delay = (ms) => new Promise(res => {
    const t = setTimeout(res, ms / speed);
    abortControllerRef.current?.signal.addEventListener('abort', () => { clearTimeout(t); res(); });
  });

  const updateSim = (updates) => setSim(prev => ({ ...prev, ...updates }));

  // --- INTERACTIVE EDITOR FUNCTIONS ---
  const handleCanvasClick = (e) => {
    if (phase !== 'IDLE' || editorMode !== 'ADD_NODE') return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    
    let newId = String.fromCharCode(65 + nodes.length);
    if (nodes.length >= 26) newId = `N${nodes.length - 25}`;
    while(nodes.find(n => n.id === newId)) {
      newId = newId.length === 1 ? String.fromCharCode(newId.charCodeAt(0) + 1) : `N${parseInt(newId.slice(1)) + 1}`;
    }
    
    setNodes([...nodes, { id: newId, x: svgP.x, y: svgP.y }]);
    if (nodes.length === 0) setStartNode(newId);
  };

  const handleNodeClick = (e, nodeId) => {
    e.stopPropagation(); 
    if (phase !== 'IDLE' || editorMode !== 'ADD_EDGE') return;
    
    if (!newEdgeStart) {
      setNewEdgeStart(nodeId); 
    } else if (newEdgeStart !== nodeId) {
      const w = window.prompt(`Enter weight for edge ${newEdgeStart} → ${nodeId}:`, "1");
      if (w !== null && !isNaN(parseInt(w))) {
        setEdges([...edges, { id: `e${Date.now()}`, from: newEdgeStart, to: nodeId, weight: parseInt(w) }]);
      }
      setNewEdgeStart(null);
    } else {
      setNewEdgeStart(null);
    }
  };

  const resetToDefault = () => { stopSimulation(); setNodes(defaultNodes); setEdges(defaultEdges); setStartNode('A'); setEditorMode('VIEW'); setNewEdgeStart(null); };
  const clearGraph = () => { stopSimulation(); setNodes([]); setEdges([]); setStartNode(''); setEditorMode('VIEW'); setNewEdgeStart(null); };

  // --- Core Algorithm ---
  const runSimulation = async () => {
    window.speechSynthesis.cancel();
    setEditorMode('VIEW');
    setNewEdgeStart(null);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    setPhase('DIJKSTRA');

    let dist = {}; nodes.forEach(n => dist[n.id] = n.id === startNode ? 0 : Infinity);
    let q = [{ id: startNode, d: 0 }];
    let relaxCount = {}; nodes.forEach(n => relaxCount[n.id] = 0);
    let trapped = false;

    updateSim({ distances: { ...dist }, queue: [...q] });
    await speak("Starting Dijkstra's Algorithm.");

    while (q.length > 0) {
      if (signal.aborted) return;
      q.sort((a, b) => a.d - b.d);
      const curr = q.shift();
      updateSim({ activeNode: curr.id, queue: [...q], logTitle: 'DIJKSTRA SIMULATION LOG', logMsg: `Processing Node ${curr.id}. Current shortest distance is ${dist[curr.id]}` });
      await delay(600);

      const neighbors = edges.filter(e => e.from === curr.id);
      for (let edge of neighbors) {
        if (signal.aborted) return;
        updateSim({ activeEdge: edge.id, logMsg: `Evaluating edge ${edge.from} → ${edge.to} (Weight: ${edge.weight})` });
        
        const newD = dist[curr.id] + edge.weight;
        if (newD < dist[edge.to]) {
          dist[edge.to] = newD;
          q.push({ id: edge.to, d: newD });
          updateSim({ distances: { ...dist }, queue: [...q], logMsg: `Shorter path found! Node ${edge.to} distance updated to ${newD}` });
          await speak(`Distance to ${edge.to} updated to ${newD}.`);
          
          relaxCount[edge.to]++;
          if (relaxCount[edge.to] > nodes.length * 2) { trapped = true; break; }
        }
        await delay(500);
        updateSim({ activeEdge: null });
      }
      if (trapped) break;
      updateSim({ activeNode: null });
    }

    if (trapped) {
      updateSim({ activeNode: null, activeEdge: null, highlightedCycle: ['e2', 'e3', 'e4'], logTitle: 'CRITICAL FAILURE', logMsg: "Dijkstra is trapped in a negative weight cycle! Distances will decrease infinitely." });
      await speak("Critical failure. Dijkstra is trapped in an infinite negative loop. Switching to Bellman-Ford.");
      await delay(2500);
    }

    if (signal.aborted) return;
    setPhase('BELLMAN_FORD');
    updateSim({ queue: [], highlightedCycle: [], logTitle: 'BELLMAN-FORD SIMULATION LOG', logMsg: `Starting Bellman-Ford. Relaxing all edges ${nodes.length > 0 ? nodes.length - 1 : 0} times.` });
    
    let parents = {};
    const V = nodes.length;

    for (let i = 1; i < V; i++) {
      if (signal.aborted) return;
      updateSim({ logMsg: `Iteration ${i} of ${V - 1}: Relaxing all edges...` });
      await speak(`Iteration ${i}.`);
      for (let edge of edges) {
        if (signal.aborted) return;
        updateSim({ activeEdge: edge.id });
        if (dist[edge.from] !== Infinity && dist[edge.from] + edge.weight < dist[edge.to]) {
          dist[edge.to] = dist[edge.from] + edge.weight;
          parents[edge.to] = { node: edge.from, edgeId: edge.id };
          updateSim({ distances: { ...dist }, logMsg: `Relaxed ${edge.from} → ${edge.to}. New dist: ${dist[edge.to]}` });
          await delay(300);
        } else { await delay(100); }
        updateSim({ activeEdge: null });
      }
    }

    updateSim({ logMsg: 'Final iteration to detect negative cycles...' });
    await speak("Final check for negative cycles.");
    let cycleStart = null;
    for (let edge of edges) {
      if (signal.aborted) return;
      updateSim({ activeEdge: edge.id });
      if (dist[edge.from] !== Infinity && dist[edge.from] + edge.weight < dist[edge.to]) {
        cycleStart = edge.to;
        parents[edge.to] = { node: edge.from, edgeId: edge.id };
        updateSim({ logMsg: `Negative cycle detected at node ${edge.to}!` });
        await speak("Negative cycle detected!");
        break;
      }
      await delay(200); updateSim({ activeEdge: null });
    }

    if (cycleStart) {
      let visited = new Set(), curr = cycleStart;
      while (!visited.has(curr)) { visited.add(curr); curr = parents[curr].node; }
      let cycleNodes = [curr], cycleEdges = [parents[curr].edgeId], next = parents[curr].node;
      while (next !== curr) {
        cycleNodes.push(next); cycleEdges.push(parents[next].edgeId); next = parents[next].node;
      }
      updateSim({ highlightedCycle: cycleEdges, logMsg: 'Cycle isolated! Propagating -∞ to all reachable nodes.' });
      await speak("Setting all nodes reachable from the cycle to negative infinity.");
      await delay(1000);

      let bq = [...cycleNodes];
      while (bq.length > 0) {
        let n = bq.shift();
        if (dist[n] !== -Infinity) {
          dist[n] = -Infinity;
          updateSim({ distances: { ...dist } });
          edges.filter(e => e.from === n).forEach(e => { if (dist[e.to] !== -Infinity) bq.push(e.to); });
        }
      }
      updateSim({ logMsg: 'Algorithm safely concluded. -∞ mapped correctly.' });
      await speak("Algorithm concluded successfully.");
    } else {
      updateSim({ logMsg: 'No negative cycles found. Optimal paths calculated.' });
      await speak("Finished.");
    }
    setPhase('FINISHED');
  };

  const stopSimulation = () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    window.speechSynthesis.cancel();
    setPhase('IDLE');
  };

  // --- Dynamic Edge Spacing Algorithm ---
  const getEdgePath = (from, to, edgeId) => {
    const parallelEdges = edges.filter(e => 
      (e.from === from.id && e.to === to.id) || 
      (e.from === to.id && e.to === from.id)
    );
    parallelEdges.sort((a, b) => a.id.localeCompare(b.id));
    const edgeIndex = parallelEdges.findIndex(e => e.id === edgeId);
    
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    const directionFlag = from.id < to.id ? 1 : -1;
    const curveSign = edgeIndex % 2 === 0 ? 1 : -1;
    const curveMultiplier = Math.floor(edgeIndex / 2) + 1; 
    
    const offset = dist * 0.15 * curveMultiplier * curveSign * directionFlag; 
    const nx = -dy / dist, ny = dx / dist;
    const cx = (from.x + to.x) / 2 + nx * offset;
    const cy = (from.y + to.y) / 2 + ny * offset;
    
    const nodeRadius = 32;
    const arrowPadding = 12; 
    
    const sdx = cx - from.x, sdy = cy - from.y;
    const sDist = Math.sqrt(sdx*sdx + sdy*sdy);
    const startX = from.x + (sdx / sDist) * nodeRadius;
    const startY = from.y + (sdy / sDist) * nodeRadius;
    
    const cdx = to.x - cx, cdy = to.y - cy;
    const cDist = Math.sqrt(cdx*cdx + cdy*cdy);
    const endX = to.x - (cdx / cDist) * (nodeRadius + arrowPadding);
    const endY = to.y - (cdy / cDist) * (nodeRadius + arrowPadding);
    
    return { path: `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`, cx, cy };
  };

  const formatD = (val) => val === Infinity ? '∞' : val === -Infinity ? '-∞' : val;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Inter', system-ui, sans-serif; background-color: #f3f4f6; color: #111827; overflow: hidden; }
        
        /* Layout Classes for Responsiveness */
        .app-container { display: flex; flex-direction: column; height: 100vh; }
        .main-wrapper { display: flex; flex: 1; overflow: hidden; }
        .left-column { flex: 1; display: flex; flex-direction: column; background-color: white; position: relative; }
        .right-sidebar { width: 380px; border-left: 1px solid #e2e8f0; background: #f8fafc; padding: 24px; overflow-y: auto; flex-shrink: 0; }
        
        .navbar { background-color: #111827; color: white; display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; }
        .nav-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        
        .editor-toolbar { border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; align-items: center; padding: 16px 24px; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
        .editor-group { display: flex; alignItems: center; gap: 24px; flex-wrap: wrap; }
        
        .floating-banner { position: absolute; top: 24px; left: 50%; transform: translateX(-50%); background: #1e293b; padding: 16px 24px; border-radius: 12px; display: flex; gap: 16px; align-items: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); width: 90%; max-width: 700px; z-index: 10; }

        /* Media Queries for Tablets and Mobile */
        @media (max-width: 1024px) {
          body { overflow: auto; } /* Allow overall page scrolling on mobile */
          .app-container { height: auto; min-height: 100vh; }
          .main-wrapper { flex-direction: column; overflow: visible; }
          .left-column { flex: none; height: 60vh; min-height: 450px; }
          .right-sidebar { width: 100%; border-left: none; border-top: 1px solid #e2e8f0; padding: 16px; flex: none; }
          .navbar { flex-direction: column; gap: 16px; padding: 16px; text-align: center; }
          .navbar p { margin: 8px 0 0 0 !important; }
          .nav-controls { justify-content: center; }
          .editor-toolbar { padding: 12px 16px; justify-content: center; text-align: center; }
          .editor-group { justify-content: center; gap: 12px; }
        }

        @media (max-width: 600px) {
          .floating-banner { flex-direction: column; text-align: center; gap: 8px; padding: 12px; }
          .btn-tool span { display: none; } /* Shrink tools on very small screens */
        }

        /* Buttons & Components */
        .btn { padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; border: none; transition: all 0.2s; }
        .btn-play { background: #3b82f6; color: white; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); } .btn-play:hover { background: #2563eb; }
        .btn-dark { background: #374151; color: white; } .btn-dark:hover { background: #4b5563; }
        .btn-voice { background: #10b981; color: white; } .btn-voice.off { background: #ef4444; }
        .btn-tool { background: white; border: 1px solid #cbd5e1; color: #64748b; }
        .btn-tool:hover { background: #f8fafc; }
        .btn-tool.active { background: #3b82f6; border-color: #3b82f6; color: white; box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3); }
        .tab-container { display: flex; background: #f1f5f9; border-radius: 8px; padding: 4px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
        .tab { flex: 1; text-align: center; padding: 8px; font-size: 14px; font-weight: 600; border-radius: 4px; color: #64748b; }
        .tab.active { background: white; color: #3b82f6; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .panel-box { background: white; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 24px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .panel-header { font-size: 11px; font-weight: 700; color: #475569; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .data-row { display: flex; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
        .editor-input { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; font-size: 14px; font-weight: 600; background: #ffffff; color: #0f172a; }
        .editor-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
      `}</style>

      <div className="app-container">
        
        {/* Navbar */}
        <div className="navbar">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center' }}>
              <Activity color="#60a5fa" size={24} />
              <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Graph Pathfinding Visualizer</h1>
            </div>
            <p style={{ margin: '4px 0 0 34px', fontSize: '13px', color: '#9ca3af' }}>Observe Dijkstra's flaw, then see Bellman-Ford calculate <span style={{color: '#f87171'}}>-∞</span> correctly.</p>
          </div>
          
          <div className="nav-controls">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1f2937', padding: '6px 16px', borderRadius: '20px', border: '1px solid #374151' }}>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>Speed</span>
              <input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} style={{ width: '80px', accentColor: '#3b82f6' }} />
              <span style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 'bold' }}>{speed}x</span>
            </div>
            
            {phase === 'IDLE' || phase === 'FINISHED' ? (
              <button className="btn btn-play" onClick={runSimulation}><Play size={16} fill="currentColor" /> Play</button>
            ) : (
              <button className="btn btn-dark" onClick={stopSimulation} style={{ background: '#ef4444' }}>Stop</button>
            )}
            <button className="btn btn-dark" onClick={stopSimulation} title="Reset"><RotateCcw size={16} /></button>
            <button className={`btn btn-voice ${voiceEnabled ? '' : 'off'}`} onClick={() => setVoiceEnabled(!voiceEnabled)}>
              {voiceEnabled ? <><Volume2 size={16} /> Voice On</> : <><VolumeX size={16} /> Voice Off</>}
            </button>
          </div>
        </div>

        {/* Main Layout */}
        <div className="main-wrapper">
          
          {/* Left Column */}
          <div className="left-column">
            
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              
              {/* Floating Banner */}
              <div className="floating-banner">
                <Info size={28} color="#3b82f6" style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8', letterSpacing: '1px', marginBottom: '4px', textTransform: 'uppercase' }}>{sim.logTitle}</div>
                  <div style={{ fontSize: '16px', color: '#f8fafc', fontWeight: '500' }}>{sim.logMsg}</div>
                </div>
              </div>

              {/* Dynamic SVG Canvas */}
              <svg 
                style={{ 
                  width: '100%', height: '100%', 
                  cursor: phase !== 'IDLE' ? 'default' : editorMode === 'ADD_NODE' ? 'crosshair' : editorMode === 'ADD_EDGE' ? 'copy' : 'default' 
                }} 
                viewBox={viewBox} 
                preserveAspectRatio="xMidYMid meet"
                onClick={handleCanvasClick}
              >
                <defs>
                  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
                  </filter>
                  <marker id="arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 2 L 10 6 L 0 10 L 3 6 z" fill="#94a3b8" />
                  </marker>
                  <marker id="arrow-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 2 L 10 6 L 0 10 L 3 6 z" fill="#3b82f6" />
                  </marker>
                  <marker id="arrow-cycle" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 2 L 10 6 L 0 10 L 3 6 z" fill="#ef4444" />
                  </marker>
                </defs>

                {edges.map(edge => {
                  const fromNode = nodes.find(n => n.id === edge.from), toNode = nodes.find(n => n.id === edge.to);
                  if (!fromNode || !toNode) return null;
                  
                  const isHigh = sim.highlightedCycle.includes(edge.id), isAct = sim.activeEdge === edge.id;
                  const { path, cx, cy } = getEdgePath(fromNode, toNode, edge.id);
                  
                  let stroke = '#94a3b8', marker = 'url(#arrow)', width = 4;
                  if (isHigh) { stroke = '#ef4444'; marker = 'url(#arrow-cycle)'; width = 6; }
                  else if (isAct) { stroke = '#3b82f6'; marker = 'url(#arrow-active)'; width = 6; }

                  return (
                    <g key={edge.id} style={{ transition: 'all 0.3s' }}>
                      <path d={path} fill="none" stroke={stroke} strokeWidth={width} markerEnd={marker} />
                      <rect x={cx - 22} y={cy - 14} width="44" height="28" rx="14" fill="white" stroke={isHigh ? '#fca5a5' : isAct ? '#93c5fd' : '#cbd5e1'} strokeWidth="2" filter="url(#shadow)" />
                      <text x={cx} y={cy} fill={edge.weight < 0 ? '#ea580c' : '#1e293b'} fontWeight="bold" fontSize="15px" textAnchor="middle" dy=".35em">{edge.weight}</text>
                    </g>
                  );
                })}

                {nodes.map(node => {
                  const isActive = sim.activeNode === node.id || newEdgeStart === node.id;
                  const dist = sim.distances[node.id];
                  const isNegInf = dist === -Infinity; 
                  
                  let strokeCol = '#1e293b';
                  let fillCol = 'white';
                  let textCol = '#0f172a';
                  let badgeCol = '#475569';

                  if (isNegInf) {
                    strokeCol = '#ef4444'; fillCol = '#fee2e2'; textCol = '#7f1d1d'; badgeCol = '#ef4444';
                  } else if (sim.activeNode === node.id) {
                    strokeCol = '#3b82f6';
                  } else if (newEdgeStart === node.id) {
                    strokeCol = '#10b981';
                  }

                  return (
                    <g 
                      key={node.id} 
                      transform={`translate(${node.x}, ${node.y})`}
                      onClick={(e) => handleNodeClick(e, node.id)}
                      style={{ cursor: editorMode === 'ADD_EDGE' ? 'pointer' : 'default' }}
                    >
                      <circle r="32" fill={fillCol} stroke={strokeCol} strokeWidth={isActive || isNegInf ? "6" : "5"} style={{ transition: 'all 0.3s' }} filter="url(#shadow)" />
                      <text textAnchor="middle" dy=".35em" fontSize="24px" fontWeight="800" fill={textCol}>{node.id}</text>
                      <rect x="-32" y="42" width="64" height="28" rx="8" fill={badgeCol} filter="url(#shadow)" />
                      <text x="0" y="56" fill="white" fontSize="14px" fontWeight="bold" textAnchor="middle" dy=".35em">{formatD(dist)}</text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Editor Toolbar */}
            <div className="editor-toolbar">
              <div className="editor-group">
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#64748b' }}>Interactive Editor:</span>
                
                <div style={{ display: 'flex', gap: '8px', background: '#e2e8f0', padding: '4px', borderRadius: '8px' }}>
                  <button className={`btn btn-tool ${editorMode === 'VIEW' ? 'active' : ''}`} onClick={() => {setEditorMode('VIEW'); setNewEdgeStart(null);}} disabled={phase !== 'IDLE'}><MousePointer2 size={16} /> <span>Select</span></button>
                  <button className={`btn btn-tool ${editorMode === 'ADD_NODE' ? 'active' : ''}`} onClick={() => {setEditorMode('ADD_NODE'); setNewEdgeStart(null);}} disabled={phase !== 'IDLE'}><Plus size={16} /> <span>Add Node</span></button>
                  <button className={`btn btn-tool ${editorMode === 'ADD_EDGE' ? 'active' : ''}`} onClick={() => setEditorMode('ADD_EDGE')} disabled={phase !== 'IDLE'}><GitCommit size={16} /> <span>Add Edge</span></button>
                </div>

                <div style={{ width: '1px', height: '30px', background: '#cbd5e1' }} className="hidden-mobile"></div>
                
                <span style={{ fontSize: '13px', fontWeight: '500', color: '#3b82f6', fontStyle: 'italic', maxWidth: '300px' }}>
                  {phase !== 'IDLE' ? 'Editor disabled during simulation.' :
                   editorMode === 'VIEW' ? 'View mode. Adjust settings above.' : 
                   editorMode === 'ADD_NODE' ? 'Click on the canvas to place a node.' : 
                   newEdgeStart ? `Click a second node to connect it to ${newEdgeStart}.` : 'Click a node to start drawing an edge.'}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#475569' }}>SOURCE:</span>
                  <select value={startNode} onChange={e => setStartNode(e.target.value)} disabled={phase !== 'IDLE'} className="editor-input" style={{ width: '70px', padding: '6px' }}>
                    {nodes.map(n => <option key={n.id} value={n.id}>{n.id}</option>)}
                  </select>
                </div>
                <button onClick={resetToDefault} className="btn" style={{ background: '#e2e8f0', color: '#475569' }} disabled={phase !== 'IDLE'}>Default</button>
                <button onClick={clearGraph} className="btn" style={{ background: '#fee2e2', color: '#ef4444' }} disabled={phase !== 'IDLE'}><Trash2 size={16} /> Clear</button>
              </div>
            </div>

          </div>

          {/* Right Sidebar */}
          <div className="right-sidebar">
            
            <div className="tab-container">
              <div className={`tab ${phase === 'DIJKSTRA' || phase === 'IDLE' ? 'active' : ''}`}>1. Dijkstra</div>
              <div className={`tab ${phase === 'BELLMAN_FORD' || phase === 'FINISHED' ? 'active' : ''}`}>2. Bellman-Ford</div>
            </div>

            <div className="panel-box">
              <div className="panel-header">
                <span>COMPLEXITY</span>
                <span style={{ background: '#dbeafe', color: '#2563eb', padding: '4px 8px', borderRadius: '4px', fontSize: '10px' }}>
                  {phase === 'BELLMAN_FORD' || phase === 'FINISHED' ? 'DYNAMIC PROGRAMMING' : 'GREEDY APPROACH'}
                </span>
              </div>
              <div className="data-row">
                <span style={{ color: '#64748b' }}>Time:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{phase === 'BELLMAN_FORD' || phase === 'FINISHED' ? 'O(V*E)' : 'O((V+E)logV)'}</span>
              </div>
              <div className="data-row" style={{ borderBottom: 'none' }}>
                <span style={{ color: '#64748b' }}>Space:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>O(V)</span>
              </div>
            </div>

            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px' }}>DISTANCE ARRAY</div>
            <div className="panel-box">
              <div className="panel-header" style={{ background: 'white' }}>
                <span>NODE</span>
                <span>SHORTEST DISTANCE</span>
              </div>
              {nodes.map(n => (
                <div key={n.id} className="data-row">
                  <span style={{ fontWeight: 'bold', color: '#1e293b' }}>{n.id}</span>
                  <span style={{ fontWeight: 'bold', fontFamily: 'monospace', fontSize: '16px', color: sim.distances[n.id] === -Infinity ? '#ef4444' : '#0f172a' }}>
                    {formatD(sim.distances[n.id])}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px' }}>PRIORITY QUEUE</div>
            <div className="panel-box" style={{ background: '#0f172a', border: 'none' }}>
              <div className="panel-header" style={{ background: '#1e293b', color: '#cbd5e1', borderBottom: '1px solid #334155' }}>
                <span>NODE</span>
                <span>PRIORITY</span>
              </div>
              {sim.queue.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#475569', fontSize: '13px' }}>Queue Empty</div>
              ) : (
                sim.queue.map((item, idx) => (
                  <div key={idx} className="data-row" style={{ borderBottom: '1px solid #1e293b' }}>
                    <span style={{ color: 'white', fontWeight: 'bold' }}>{item.id}</span>
                    <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{item.d}</span>
                  </div>
                ))
              )}
            </div>

          </div>

        </div>
      </div>
    </>
  );
}