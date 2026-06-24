// Frontend Logic for AI Research Suite - Unified Graph Flow Layout

document.addEventListener("DOMContentLoaded", () => {
    // Font Scaling Logic
    const defaultScale = 1.15;
    let textScale = parseFloat(localStorage.getItem("text-scale")) || defaultScale;
    
    function applyTextScale(scale) {
        document.documentElement.style.setProperty("--text-scale", scale.toFixed(2));
        localStorage.setItem("text-scale", scale);
    }
    
    // Initial apply
    applyTextScale(textScale);
    
    const btnFontDec = document.getElementById("btn-font-dec");
    const btnFontReset = document.getElementById("btn-font-reset");
    const btnFontInc = document.getElementById("btn-font-inc");
    
    if (btnFontDec && btnFontReset && btnFontInc) {
        btnFontDec.addEventListener("click", () => {
            textScale = Math.max(0.9, textScale - 0.1);
            applyTextScale(textScale);
        });
        btnFontReset.addEventListener("click", () => {
            textScale = defaultScale;
            applyTextScale(textScale);
        });
        btnFontInc.addEventListener("click", () => {
            textScale = Math.min(1.5, textScale + 0.1);
            applyTextScale(textScale);
        });
    }

    // DOM Elements
    const queryInput = document.getElementById("query-input");
    const btnSubmitQuery = document.getElementById("btn-submit-query");
    const btnNewResearch = document.getElementById("btn-new-research");
    const welcomeView = document.getElementById("welcome-view");
    const sessionsList = document.getElementById("sessions-list");
    const connectionStatus = document.getElementById("connection-status");
    const currentNodeDisplay = document.getElementById("current-node-display");
    
    // Unified Flow View
    const unifiedFlowView = document.getElementById("unified-flow-view");
    
    // Clarification Static Form Elements
    const clarificationForm = document.getElementById("clarification-form");
    const clarificationRecord = document.getElementById("clarification-record");
    const clarificationText = document.getElementById("clarification-text");
    const clarificationInputField = document.getElementById("clarification-input-field");
    const btnSubmitClarification = document.getElementById("btn-submit-clarification");
    const clarificationSavedQuestion = document.getElementById("clarification-saved-question");
    const clarificationSavedAnswer = document.getElementById("clarification-saved-answer");

    // Flow Nodes mapping
    const flowNodes = {
        "intent_parser": document.getElementById("fnode-intent"),
        "clarification": document.getElementById("fnode-clarify"),
        "planner": document.getElementById("fnode-planner"),
        "executor": document.getElementById("fnode-executor"),
        "credibility": document.getElementById("fnode-credibility"),
        "optimist": document.getElementById("fnode-optimist"),
        "skeptic": document.getElementById("fnode-skeptic"),
        "judge": document.getElementById("fnode-judge")
    };
    
    // Inline Details Drawers
    const flowDrawers = {
        "query": document.getElementById("fdetail-query"),
        "intent_parser": document.getElementById("fdetail-intent"),
        "clarification": document.getElementById("fdetail-clarify"),
        "planner": document.getElementById("fdetail-planner"),
        "executor": document.getElementById("fdetail-executor"),
        "credibility": document.getElementById("fdetail-credibility"),
        "debate": document.getElementById("fdetail-debate"),
        "judge": document.getElementById("fdetail-judge")
    };

    // Node ID to Drawer key map
    const nodeToDrawerMap = {
        "fnode-query": "query",
        "fnode-intent": "intent_parser",
        "fnode-clarify": "clarification",
        "fnode-planner": "planner",
        "fnode-executor": "executor",
        "fnode-credibility": "credibility",
        "fnode-optimist": "debate",
        "fnode-skeptic": "debate",
        "fnode-judge": "judge"
    };

    let currentSessionId = null;
    let eventSource = null;

    // Load initial sessions list
    loadSessions();

    // Event Listeners
    btnSubmitQuery.addEventListener("click", startResearch);
    btnNewResearch.addEventListener("click", resetToNewResearch);
    btnSubmitClarification.addEventListener("click", submitClarification);
    
    // Press Enter to submit clarification
    clarificationInputField.addEventListener("keypress", (e) => {
        if (e.key === "Enter") submitClarification();
    });

    // Toggle timeline detail drawer visibility on header click
    document.querySelectorAll(".flow-node").forEach(node => {
        node.addEventListener("click", () => {
            const drawerKey = nodeToDrawerMap[node.id];
            const drawer = flowDrawers[drawerKey];
            if (drawer) {
                drawer.classList.toggle("hidden");
            }
        });
    });

    // -------------------------------------------------------------------------
    // Core Actions
    // -------------------------------------------------------------------------

    async function startResearch() {
        const query = queryInput.value.trim();
        if (!query) return;

        resetUIForNewRun();
        
        // Populate and open the User Query drawer
        flowDrawers["query"].classList.remove("hidden");
        flowDrawers["query"].innerHTML = `<div class="user-query-text">${escapeHtml(query)}</div>`;
        
        updateStatus("Processing...", "yellow");
        
        try {
            const response = await fetch("/api/research/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query })
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            currentSessionId = response.headers.get("X-Session-Id");
            handleStream(response.body);
        } catch (err) {
            console.error(err);
            updateStatus("Error", "red");
            handleError(err.message);
        }
    }

    async function submitClarification() {
        const answer = clarificationInputField.value.trim();
        if (!answer || !currentSessionId) return;

        // Transition clarification inline view to a clean read-only record
        clarificationForm.classList.add("hidden");
        clarificationRecord.classList.remove("hidden");
        clarificationSavedQuestion.textContent = clarificationText.textContent;
        clarificationSavedAnswer.innerHTML = `<strong>Your Answer:</strong> ${escapeHtml(answer)}`;
        clarificationInputField.value = "";
        
        updateStatus("Resuming...", "yellow");

        try {
            const response = await fetch("/api/research/clarify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: currentSessionId,
                    answer: answer
                })
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            handleStream(response.body);
        } catch (err) {
            console.error(err);
            updateStatus("Error", "red");
            handleError(err.message);
        }
    }

    // -------------------------------------------------------------------------
    // Stream Parsing
    // -------------------------------------------------------------------------

    async function handleStream(stream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop(); // keep partial event in buffer

            for (const part of parts) {
                if (!part.trim()) continue;
                parseSSEEvent(part);
            }
        }
    }

    function parseSSEEvent(eventString) {
        const lines = eventString.split("\n");
        let eventType = "message";
        let rawData = "";

        for (const line of lines) {
            if (line.startsWith("event: ")) {
                eventType = line.substring(7).trim();
            } else if (line.startsWith("data: ")) {
                rawData = line.substring(6).trim();
            }
        }

        if (!rawData) return;
        
        try {
            const data = JSON.parse(rawData);
            dispatchSSEEvent(eventType, data);
        } catch (e) {
            console.error("Failed to parse event JSON", e, rawData);
        }
    }

    function dispatchSSEEvent(type, data) {
        console.log(`[SSE Event: ${type}]`, data);

        switch (type) {
            case "node_update":
                handleNodeUpdate(data.node, data.state_update);
                break;
            case "clarification":
                handleClarificationNeeded(data);
                break;
            case "complete":
                handleComplete(data);
                break;
            case "error":
                handleError(data.message);
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Event Handlers
    // -------------------------------------------------------------------------

    function handleNodeUpdate(node, state, autoExpand = true) {
        currentNodeDisplay.textContent = node.toUpperCase().replace("_", " ");
        
        // Sync Node & Connector colors
        updateNodeAndConnectorColors(node, state);
        
        // Auto-expand active node details and scroll to it
        if (autoExpand) {
            const drawerKey = node === "optimist" || node === "skeptic" ? "debate" : node;
            const drawer = flowDrawers[drawerKey];
            if (drawer) {
                drawer.classList.remove("hidden");
                const wrapper = document.getElementById(`fwrapper-${drawerKey}`) || document.getElementById(`fwrapper-debate`);
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }

        // Render intermediary data inside details drawers
        renderDrawerContent(node, state);
    }

    function updateNodeAndConnectorColors(node, state) {
        const order = ["intent_parser", "clarification", "planner", "executor", "credibility", "debate", "judge"];
        const activeNodeKey = (node === "optimist" || node === "skeptic") ? "debate" : node;
        const activeIdx = order.indexOf(activeNodeKey);

        order.forEach((nodeKey, idx) => {
            const isCompleted = idx < activeIdx || activeNodeKey === "judge" || (idx === activeIdx && node === "judge");
            const isActive = idx === activeIdx && node !== "judge";

            let statusClass = "pending";
            let statusText = "PENDING";

            if (isCompleted) {
                statusClass = "completed";
                statusText = "DONE";
            } else if (isActive) {
                statusClass = "active";
                statusText = "RUNNING";
            }

            if (nodeKey === "intent_parser") {
                updateNodeElement("fnode-intent", statusClass, statusText);
                updateConnectorElement("fconn-intent", statusClass);
            } else if (nodeKey === "clarification") {
                if (isCompleted && !state.clarification) {
                    updateNodeElement("fnode-clarify", "completed", "BYPASSED");
                } else {
                    updateNodeElement("fnode-clarify", statusClass, statusText);
                }
                updateConnectorElement("fconn-clarify", statusClass);
            } else if (nodeKey === "planner") {
                updateNodeElement("fnode-planner", statusClass, statusText);
                updateConnectorElement("fconn-planner", statusClass);
            } else if (nodeKey === "executor") {
                updateNodeElement("fnode-executor", statusClass, statusText);
                updateConnectorElement("fconn-executor", statusClass);
                syncParallelExecutors(state, node);
            } else if (nodeKey === "credibility") {
                updateNodeElement("fnode-credibility", statusClass, statusText);
                updateConnectorElement("fconn-credibility", statusClass);
            } else if (nodeKey === "debate") {
                let optStatus = statusClass;
                let skpStatus = statusClass;
                let optText = statusText;
                let skpText = statusText;

                if (isActive) {
                    if (node === "optimist") {
                        optStatus = "active"; optText = "RUNNING";
                        skpStatus = "pending"; skpText = "PENDING";
                    } else if (node === "skeptic") {
                        optStatus = "completed"; optText = "DONE";
                        skpStatus = "active"; skpText = "RUNNING";
                    }
                }

                updateNodeElement("fnode-optimist", optStatus, optText);
                updateNodeElement("fnode-skeptic", skpStatus, skpText);

                const splitPath = document.getElementById("path-split");
                if (splitPath) {
                    splitPath.setAttribute("stroke", isCompleted ? "var(--accent-green)" : (isActive ? "var(--accent-purple)" : "rgba(255,255,255,0.08)"));
                }
                const mergePath = document.getElementById("path-merge");
                if (mergePath) {
                    mergePath.setAttribute("stroke", isCompleted ? "var(--accent-green)" : ((isActive && node === "skeptic") ? "rgba(139, 92, 246, 0.4)" : "rgba(255,255,255,0.08)"));
                }
            } else if (nodeKey === "judge") {
                updateNodeElement("fnode-judge", statusClass, statusText);
            }
        });
    }

    function renderDrawerContent(node, state) {
        const drawerKey = node === "optimist" || node === "skeptic" ? "debate" : node;
        const drawer = flowDrawers[drawerKey];
        if (!drawer) return;

        if (node === "intent_parser" && state.parsed_query) {
            const parsed = state.parsed_query;
            drawer.innerHTML = `
                <div class="intent-details">
                    <p><strong>Topics Identified:</strong> ${parsed.topics ? parsed.topics.join(", ") : "None"}</p>
                    <p><strong>Resolved Location:</strong> ${parsed.location || "Global"}</p>
                    <p><strong>Time Horizon:</strong> ${parsed.time_range}</p>
                </div>
            `;
        }

        if (node === "clarification") {
            if (!state.clarification) {
                drawer.innerHTML = `<p class="bypassed-msg">Bypassed — No disambiguation required.</p>`;
            }
        }

        if (node === "planner" && state.research_plan) {
            const steps = state.research_plan.steps || [];
            drawer.innerHTML = `
                <div class="planner-details">
                    <p><strong>Formulated Steps (${steps.length}):</strong></p>
                    <ul style="list-style-type: decimal; margin-left: 20px; margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
                        ${steps.map(s => `<li><code>${s.tool}</code>: "${s.query}"</li>`).join("")}
                    </ul>
                </div>
            `;
        }

        if (node === "executor" && state.step_results) {
            const results = state.step_results;
            const plan = state.research_plan;
            
            let html = `<p><strong>Gathered Evidence (${results.length}):</strong></p><div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">`;
            results.forEach((r, idx) => {
                const step = plan ? plan.steps.find(s => s.step_id === r.step_id) : null;
                const queryTitle = step ? `Step ${idx+1}: ${step.tool} ('${step.query}')` : `Step ${idx+1}`;
                html += `
                    <div class="accordion" id="accordion-${r.step_id}">
                        <div class="accordion-trigger" onclick="this.nextElementSibling.classList.toggle('hidden')">
                            <span>🔍 ${queryTitle}</span>
                            <span>Quality: <strong>${r.evidence_quality}</strong></span>
                        </div>
                        <div class="accordion-content hidden">
                            <p style="white-space: pre-wrap; font-family: var(--font-mono); font-size: 11.5px; opacity: 0.85;">${escapeHtml(r.raw_data)}</p>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
            drawer.innerHTML = html;
        }

        if (node === "credibility" && state.step_results) {
            const results = state.step_results;
            let html = `<p><strong>Source Authority Mapping:</strong></p><div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">`;
            results.forEach(r => {
                if (r.credibility && r.credibility.length > 0) {
                    r.credibility.forEach(c => {
                        const score = ((c.authority_score + c.recency_score + c.relevance_score) / 3).toFixed(2);
                        html += `
                            <div class="credibility-source-card" data-step-id="${r.step_id}" onclick="window.scrollToTimelineStep('${r.step_id}')" onmouseover="window.highlightTimelineStep('${r.step_id}', true)" onmouseout="window.highlightTimelineStep('${r.step_id}', false)">
                                <span>🌐 <strong>${c.source}</strong></span>
                                <span>Score: <strong style="color: var(--accent-cyan);">${score}</strong></span>
                            </div>
                        `;
                    });
                }
            });
            html += `</div>`;
            drawer.innerHTML = html;
        }

        if ((node === "optimist" || node === "skeptic") && (state.optimist_argument || state.skeptic_argument)) {
            let optimistText = "Drafting positive case...";
            let skepticText = "Challenging claims...";
            let optimistCitations = [];
            let skepticCitations = [];
            
            if (state.optimist_argument) {
                try {
                    const opt = JSON.parse(state.optimist_argument);
                    optimistText = opt.claim || state.optimist_argument;
                    optimistCitations = opt.evidence_cited || [];
                } catch {
                    optimistText = state.optimist_argument;
                }
            }
            if (state.skeptic_argument) {
                try {
                    const skp = JSON.parse(state.skeptic_argument);
                    skepticText = skp.claim || state.skeptic_argument;
                    skepticCitations = skp.evidence_cited || [];
                } catch {
                    skepticText = state.skeptic_argument;
                }
            }

            drawer.innerHTML = `
                <p><strong>Adversarial Counter-Analysis Logs:</strong></p>
                <div class="debate-grid">
                    <div class="debate-card optimist">
                        <h5>Optimist Case</h5>
                        <div>${parseMarkdown(optimistText)}</div>
                        ${optimistCitations.length > 0 ? `
                            <div class="debate-citations">
                                <span>Cites:</span>
                                ${optimistCitations.map(c => `<span class="citation-badge" data-step-id="${c}" onclick="window.scrollToTimelineStep('${c}')" onmouseover="window.highlightTimelineStep('${c}', true)" onmouseout="window.highlightTimelineStep('${c}', false)">${c}</span>`).join(" ")}
                            </div>
                        ` : ''}
                    </div>
                    <div class="debate-card skeptic">
                        <h5>Skeptic Attack</h5>
                        <div>${parseMarkdown(skepticText)}</div>
                        ${skepticCitations.length > 0 ? `
                            <div class="debate-citations">
                                <span>Cites:</span>
                                ${skepticCitations.map(c => `<span class="citation-badge" data-step-id="${c}" onclick="window.scrollToTimelineStep('${c}')" onmouseover="window.highlightTimelineStep('${c}', true)" onmouseout="window.highlightTimelineStep('${c}', false)">${c}</span>`).join(" ")}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if (node === "judge" && state.final_answer) {
            let html = `
                <div class="verdict-inline-presentation">
                    <div class="verdict-inline-header">
                        <span class="verdict-badge-icon">⚖️</span>
                        <h3>Calibrated Synthesis Verdict</h3>
                    </div>
                    <div class="verdict-inline-meta">
                        <div class="verdict-meta-item">
                            <span class="meta-label">Consensus Verdict</span>
                            <span class="meta-value" style="color: var(--accent-cyan); font-weight: 700;">${(state.winning_position || "split").toUpperCase()}</span>
                        </div>
                        <div class="verdict-meta-item">
                            <span class="meta-label">Confidence Score</span>
                            <span class="meta-value" style="color: var(--accent-green); font-weight: 700;">${state.answer_confidence ? (state.answer_confidence * 100).toFixed(0) : "N/A"}%</span>
                        </div>
                    </div>
                    <div class="verdict-present-answer">
                        ${parseMarkdown(state.final_answer)}
                    </div>
            `;

            if (state.uncertainty_flags && state.uncertainty_flags.length > 0) {
                html += `
                    <div class="verdict-section">
                        <h4>⚠️ Uncertainty Flags (Treat with Caution)</h4>
                        <ul class="verdict-flags-list">
                            ${state.uncertainty_flags.map(flag => `<li>${escapeHtml(flag)}</li>`).join("")}
                        </ul>
                    </div>
                `;
            }

            if (state.recommended_followup) {
                html += `
                    <div class="verdict-section">
                        <h4>💡 Recommended Follow-up Action</h4>
                        <p class="verdict-followup-text">${escapeHtml(state.recommended_followup)}</p>
                    </div>
                `;
            }

            html += `</div>`;
            drawer.innerHTML = html;
        }
    }

    function syncParallelExecutors(state, activeNode) {
        const results = state.step_results || [];
        const plan = state.research_plan;
        const executorsRow = document.getElementById("fnode-executors-row");
        if (executorsRow) {
            if (plan && plan.steps && plan.steps.length > 0) {
                executorsRow.classList.remove("hidden");
                let execHtml = "";
                plan.steps.forEach((step, idx) => {
                    const isCompleted = results.some(r => r.step_id === step.step_id);
                    const isActive = !isCompleted && activeNode === "executor" && plan.current_step_idx === idx;
                    
                    let statusClass = "pending";
                    let statusText = "PENDING";
                    if (isCompleted) {
                        statusClass = "completed";
                        statusText = "DONE";
                    } else if (isActive) {
                        statusClass = "active";
                        statusText = "RUNNING";
                    }
                    
                    execHtml += `
                        <div class="flow-node ${statusClass}" onclick="window.scrollToTimelineStep('${step.step_id}')">
                            <div class="node-icon">⚙️</div>
                            <div class="node-content">
                                <h5>Step ${idx+1}: ${step.tool}</h5>
                                <span class="node-status">${statusText}</span>
                            </div>
                        </div>
                    `;
                });
                executorsRow.innerHTML = execHtml;
            } else {
                executorsRow.classList.add("hidden");
                executorsRow.innerHTML = "";
            }
        }
    }

    function handleClarificationNeeded(data) {
        updateStatus("Awaiting Clarification", "yellow");
        currentNodeDisplay.textContent = "AWAITING INPUT";
        
        updateNodeElement("fnode-clarify", "active", "RUNNING");
        
        flowDrawers["clarification"].classList.remove("hidden");
        clarificationForm.classList.remove("hidden");
        clarificationRecord.classList.add("hidden");
        clarificationText.textContent = data.question;
        clarificationInputField.focus();
        
        const wrapper = document.getElementById("fwrapper-clarify");
        if (wrapper) {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function handleComplete(state) {
        updateStatus("Completed", "green");
        currentNodeDisplay.textContent = "COMPLETE";
        
        // Sync everything complete
        handleNodeUpdate("judge", state, true);
        loadSessions();
    }

    function handleError(message) {
        updateStatus("Error", "red");
        currentNodeDisplay.textContent = "FAILED";
        
        const activeNode = document.querySelector(".flow-node.active");
        if (activeNode) {
            activeNode.classList.add("failed");
            const drawerKey = nodeToDrawerMap[activeNode.id];
            const drawer = flowDrawers[drawerKey];
            if (drawer) {
                drawer.classList.remove("hidden");
                drawer.innerHTML += `<div class="error-msg" style="color: var(--accent-pink); font-weight: 600; margin-top: 12px;">⚠️ Error: ${escapeHtml(message)}</div>`;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Sidebar & Session UI Synchronization
    // -------------------------------------------------------------------------

    async function loadSessions() {
        try {
            const res = await fetch("/api/sessions");
            const data = await res.json();
            
            sessionsList.innerHTML = "";
            if (data.length === 0) {
                sessionsList.innerHTML = `<li style="text-align: center; color: var(--text-muted); cursor: default; font-size: 13px; margin-top: 10px;">No historical runs</li>`;
                return;
            }

            data.forEach(sess => {
                const li = document.createElement("li");
                li.id = `sess-${sess.session_id}`;
                if (sess.session_id === currentSessionId) {
                    li.classList.add("active");
                }
                
                const formattedTime = new Date(sess.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                
                li.innerHTML = `
                    <div class="session-item-content">
                        <h4>${escapeHtml(sess.query)}</h4>
                        <div class="session-meta">
                            <span>Status: <strong>${sess.status}</strong></span>
                            <span>${formattedTime}</span>
                        </div>
                    </div>
                    <button class="btn-delete-session" title="Delete Session">×</button>
                `;
                li.querySelector(".session-item-content").addEventListener("click", () => loadSessionDetails(sess.session_id));
                
                const deleteBtn = li.querySelector(".btn-delete-session");
                deleteBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    
                    if (deleteBtn.classList.contains("confirm-delete")) {
                        try {
                            const res = await fetch(`/api/sessions/${sess.session_id}`, {
                                method: "DELETE"
                            });
                            if (!res.ok) throw new Error("Failed to delete session");
                            
                            if (currentSessionId === sess.session_id) {
                                resetToNewResearch();
                            }
                            loadSessions();
                        } catch (err) {
                            console.error(err);
                            deleteBtn.textContent = "Err";
                            setTimeout(() => {
                                deleteBtn.textContent = "×";
                                deleteBtn.classList.remove("confirm-delete");
                            }, 2000);
                        }
                    } else {
                        deleteBtn.textContent = "Sure?";
                        deleteBtn.classList.add("confirm-delete");
                        
                        const resetHandler = () => {
                            deleteBtn.textContent = "×";
                            deleteBtn.classList.remove("confirm-delete");
                            deleteBtn.removeEventListener("mouseleave", resetHandler);
                        };
                        deleteBtn.addEventListener("mouseleave", resetHandler);
                        
                        setTimeout(() => {
                            if (deleteBtn.classList.contains("confirm-delete")) {
                                resetHandler();
                            }
                        }, 3000);
                    }
                });

                sessionsList.appendChild(li);
            });
        } catch (err) {
            console.error("Failed to load historical sessions:", err);
        }
    }

    async function loadSessionDetails(sessionId) {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        currentSessionId = sessionId;
        
        const items = sessionsList.querySelectorAll("li");
        items.forEach(el => el.classList.remove("active"));
        const activeItem = document.getElementById(`sess-${sessionId}`);
        if (activeItem) activeItem.classList.add("active");

        updateStatus("Loading...", "yellow");
        
        try {
            const res = await fetch(`/api/sessions/${sessionId}`);
            if (!res.ok) throw new Error("Failed to load session details");
            const sess = await res.json();

            welcomeView.classList.add("hidden");
            unifiedFlowView.classList.remove("hidden");

            const state = sess.state;

            // Reset all drawers and classes
            Object.keys(flowDrawers).forEach(k => {
                if (k !== "query") {
                    flowDrawers[k].classList.add("hidden");
                    flowDrawers[k].innerHTML = "";
                }
            });
            Object.keys(flowNodes).forEach(k => {
                flowNodes[k].className = flowNodes[k].className.split(" ")[0]; // reset classes
            });
            const splitPath = document.getElementById("path-split");
            if (splitPath) splitPath.setAttribute("stroke", "rgba(255,255,255,0.08)");
            const mergePath = document.getElementById("path-merge");
            if (mergePath) mergePath.setAttribute("stroke", "rgba(255,255,255,0.08)");
            const executorsRow = document.getElementById("fnode-executors-row");
            if (executorsRow) {
                executorsRow.classList.add("hidden");
                executorsRow.innerHTML = "";
            }

            // Populate user query
            flowDrawers["query"].classList.remove("hidden");
            flowDrawers["query"].innerHTML = `<div class="user-query-text">${escapeHtml(sess.query)}</div>`;

            const statusMap = {
                "processing": ["intent_parser"],
                "awaiting_clarification": ["intent_parser", "clarification"],
                "completed": ["intent_parser", "clarification", "planner", "executor", "credibility", "optimist", "skeptic", "judge"],
                "failed": []
            };

            const nodesToComplete = statusMap[sess.status] || [];
            nodesToComplete.forEach(node => {
                handleNodeUpdate(node, state, false); // autoExpand = false
            });

            // Expand final node / handle state-specific views
            if (sess.status === "completed") {
                updateStatus("Completed", "green");
                currentNodeDisplay.textContent = "COMPLETE";
                flowDrawers["judge"].classList.remove("hidden");
                document.getElementById("fwrapper-judge").scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (sess.status === "awaiting_clarification") {
                updateStatus("Awaiting Clarification", "yellow");
                currentNodeDisplay.textContent = "AWAITING INPUT";
                
                if (state.clarification) {
                    flowDrawers["clarification"].classList.remove("hidden");
                    clarificationForm.classList.remove("hidden");
                    clarificationRecord.classList.add("hidden");
                    clarificationText.textContent = state.clarification.question;
                    document.getElementById("fwrapper-clarify").scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } else if (sess.status === "failed") {
                updateStatus("Failed", "red");
                currentNodeDisplay.textContent = "FAILED";
            } else {
                updateStatus(sess.status.charAt(0).toUpperCase() + sess.status.slice(1), "yellow");
                if (nodesToComplete.length > 0) {
                    const lastNode = nodesToComplete[nodesToComplete.length - 1];
                    const drawerKey = lastNode === "optimist" || lastNode === "skeptic" ? "debate" : lastNode;
                    flowDrawers[drawerKey].classList.remove("hidden");
                    const wrapper = document.getElementById(`fwrapper-${drawerKey}`) || document.getElementById(`fwrapper-debate`);
                    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        } catch (err) {
            console.error(err);
            updateStatus("Error Loading", "red");
        }
    }

    // -------------------------------------------------------------------------
    // UI Helpers & Cleanup
    // -------------------------------------------------------------------------

    function resetUIForNewRun() {
        welcomeView.classList.add("hidden");
        unifiedFlowView.classList.remove("hidden");
        
        // Clean flow drawers and classes
        Object.keys(flowDrawers).forEach(key => {
            flowDrawers[key].classList.add("hidden");
            flowDrawers[key].innerHTML = "";
        });
        Object.keys(flowNodes).forEach(key => {
            flowNodes[key].className = flowNodes[key].className.split(" ")[0]; // keeps only primary class like 'flow-node'
        });
        
        const splitPath = document.getElementById("path-split");
        if (splitPath) splitPath.setAttribute("stroke", "rgba(255,255,255,0.08)");
        const mergePath = document.getElementById("path-merge");
        if (mergePath) mergePath.setAttribute("stroke", "rgba(255,255,255,0.08)");
        const executorsRow = document.getElementById("fnode-executors-row");
        if (executorsRow) {
            executorsRow.classList.add("hidden");
            executorsRow.innerHTML = "";
        }

        clarificationForm.classList.add("hidden");
        clarificationRecord.classList.add("hidden");
        
        currentNodeDisplay.textContent = "STARTING";
    }

    function resetToNewResearch() {
        currentSessionId = null;
        welcomeView.classList.remove("hidden");
        unifiedFlowView.classList.add("hidden");
        queryInput.value = "";
        
        const items = sessionsList.querySelectorAll("li");
        items.forEach(el => el.classList.remove("active"));
        
        currentNodeDisplay.textContent = "IDLE";
        updateStatus("Agent Engine Online", "green");
    }

    // Interactive Highlight & Scroll Handlers for Citations
    window.highlightTimelineStep = function(stepId, highlight) {
        const accordion = document.getElementById(`accordion-${stepId}`);
        if (accordion) {
            if (highlight) {
                accordion.classList.add("highlight-pulse");
                flowDrawers["executor"].classList.remove("hidden");
                const content = accordion.querySelector(".accordion-content");
                if (content) content.classList.remove("hidden");
            } else {
                accordion.classList.remove("highlight-pulse");
            }
        }
        const parentStep = document.getElementById("fnode-executor");
        if (parentStep) {
            if (highlight) {
                parentStep.classList.add("highlight-pulse");
            } else {
                parentStep.classList.remove("highlight-pulse");
            }
        }
    };

    window.scrollToTimelineStep = function(stepId) {
        const accordion = document.getElementById(`accordion-${stepId}`);
        if (accordion) {
            flowDrawers["executor"].classList.remove("hidden");
            const content = accordion.querySelector(".accordion-content");
            if (content) content.classList.remove("hidden");
            
            accordion.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            accordion.classList.add("highlight-pulse");
            setTimeout(() => {
                accordion.classList.remove("highlight-pulse");
            }, 2000);
        }
    };

    // -------------------------------------------------------------------------
    // Markdown Compiler
    // -------------------------------------------------------------------------

    function parseMarkdown(text) {
        if (!text) return "";
        
        let html = escapeHtml(text);
        
        // Code Blocks
        const codeBlocks = [];
        html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
            const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
            codeBlocks.push(`<pre class="code-block"><code>${code.trim()}</code></pre>`);
            return placeholder;
        });

        // Inline Code
        const inlineCodes = [];
        html = html.replace(/`([^`\n]+)`/g, (match, code) => {
            const placeholder = `__INLINE_CODE_PLACEHOLDER_${inlineCodes.length}__`;
            inlineCodes.push(`<code class="inline-code">${code}</code>`);
            return placeholder;
        });

        const lines = html.split('\n');
        let inList = false;
        let listType = null;
        let inTable = false;
        let tableRows = [];
        let tableHeader = "";
        const processedLines = [];

        function parseTableCells(rowText, tag) {
            const parts = rowText.trim().split(/(?<!\\)\|/);
            if (parts[0] === '') parts.shift();
            if (parts[parts.length - 1] === '') parts.pop();
            return parts.map(cell => {
                const cleaned = cell.trim().replace(/\\\|/g, '|');
                return `<${tag}>${cleaned}</${tag}>`;
            }).join('');
        }

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const trimmed = line.trim();
            const isRow = trimmed.startsWith('|') && trimmed.endsWith('|');

            if (inTable) {
                if (isRow) {
                    tableRows.push(`<tr>${parseTableCells(line, 'td')}</tr>`);
                } else {
                    // Close the table
                    processedLines.push('<div class="table-container">');
                    processedLines.push('<table class="markdown-table">');
                    processedLines.push(`<thead>${tableHeader}</thead>`);
                    processedLines.push(`<tbody>${tableRows.join('\n')}</tbody>`);
                    processedLines.push('</table>');
                    processedLines.push('</div>');
                    
                    inTable = false;
                    tableRows = [];
                    tableHeader = "";
                    
                    // Process the current non-table line
                    processNormalLine(line);
                }
            } else {
                // Check if starting a table
                if (isRow && i + 1 < lines.length && /^\|\s*[:\-|\s]+\s*\|$/.test(lines[i+1].trim())) {
                    inTable = true;
                    tableHeader = `<tr>${parseTableCells(line, 'th')}</tr>`;
                    i++; // Skip the separator row
                } else {
                    processNormalLine(line);
                }
            }

            function processNormalLine(lineVal) {
                const ulMatch = lineVal.match(/^(\s*)[-*]\s+(.*)$/);
                const olMatch = lineVal.match(/^(\s*)\d+\.\s+(.*)$/);
                
                if (ulMatch) {
                    if (!inList || listType !== 'ul') {
                        if (inList) processedLines.push(`</${listType}>`);
                        processedLines.push('<ul>');
                        inList = true;
                        listType = 'ul';
                    }
                    processedLines.push(`<li>${ulMatch[2]}</li>`);
                } else if (olMatch) {
                    if (!inList || listType !== 'ol') {
                        if (inList) processedLines.push(`</${listType}>`);
                        processedLines.push('<ol>');
                        inList = true;
                        listType = 'ol';
                    }
                    processedLines.push(`<li>${olMatch[2]}</li>`);
                } else {
                    if (inList) {
                        processedLines.push(`</${listType}>`);
                        inList = false;
                        listType = null;
                    }
                    
                    const h6Match = lineVal.match(/^\s{0,3}######\s+(.*)$/);
                    const h5Match = lineVal.match(/^\s{0,3}#####\s+(.*)$/);
                    const h4Match = lineVal.match(/^\s{0,3}####\s+(.*)$/);
                    const h3Match = lineVal.match(/^\s{0,3}###\s+(.*)$/);
                    const h2Match = lineVal.match(/^\s{0,3}##\s+(.*)$/);
                    const h1Match = lineVal.match(/^\s{0,3}#\s+(.*)$/);
                    const bqMatch = lineVal.match(/^\s{0,3}&gt;\s*(.*)$/);
                    
                    if (h6Match) {
                        processedLines.push(`<h6>${h6Match[1]}</h6>`);
                    } else if (h5Match) {
                        processedLines.push(`<h5>${h5Match[1]}</h5>`);
                    } else if (h4Match) {
                        processedLines.push(`<h4>${h4Match[1]}</h4>`);
                    } else if (h3Match) {
                        processedLines.push(`<h3>${h3Match[1]}</h3>`);
                    } else if (h2Match) {
                        processedLines.push(`<h2>${h2Match[1]}</h2>`);
                    } else if (h1Match) {
                        processedLines.push(`<h1>${h1Match[1]}</h1>`);
                    } else if (bqMatch) {
                        processedLines.push(`<blockquote>${bqMatch[1]}</blockquote>`);
                    } else if (lineVal.trim() === '---') {
                        processedLines.push('<hr>');
                    } else if (lineVal.trim() === '') {
                        processedLines.push('<div class="paragraph-spacing"></div>');
                    } else {
                        processedLines.push(lineVal);
                    }
                }
            }
        }

        // Close trailing table if open
        if (inTable) {
            processedLines.push('<div class="table-container">');
            processedLines.push('<table class="markdown-table">');
            processedLines.push(`<thead>${tableHeader}</thead>`);
            processedLines.push(`<tbody>${tableRows.join('\n')}</tbody>`);
            processedLines.push('</table>');
            processedLines.push('</div>');
        }
        
        if (inList) {
            processedLines.push(`</${listType}>`);
        }

        html = processedLines.join('\n');

        html = html.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');
        html = html.replace(/__([\s\S]*?)__/g, '<strong>$1</strong>');
        html = html.replace(/_([\s\S]*?)_/g, '<em>$1</em>');

        inlineCodes.forEach((val, idx) => {
            html = html.replace(`__INLINE_CODE_PLACEHOLDER_${idx}__`, val);
        });
        codeBlocks.forEach((val, idx) => {
            html = html.replace(`__CODE_BLOCK_PLACEHOLDER_${idx}__`, val);
        });

        // Parse citations [step_X]
        html = html.replace(/\[(step_\d+(?:_aug)?)\]/g, (match, stepId) => {
            return `<span class="citation-badge" data-step-id="${stepId}" onclick="window.scrollToTimelineStep('${stepId}')" onmouseover="window.highlightTimelineStep('${stepId}', true)" onmouseout="window.highlightTimelineStep('${stepId}', false)">${stepId}</span>`;
        });
        
        return html;
    }

    function updateNodeElement(id, className, statusText) {
        const el = document.getElementById(id);
        if (el) {
            el.className = `flow-node ${className}`;
            const statusEl = el.querySelector(".node-status");
            if (statusEl) statusEl.textContent = statusText;
        }
    }

    function updateConnectorElement(id, className) {
        const el = document.getElementById(id);
        if (el) {
            el.className = `flow-connector vertical ${className}`;
        }
    }

    function updateStatus(text, colorClass) {
        connectionStatus.textContent = text;
        const dot = document.querySelector(".status-dot");
        if (dot) dot.className = `status-dot ${colorClass}`;
    }

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});
