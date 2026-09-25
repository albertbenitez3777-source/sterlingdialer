import { TeamSnapshot } from '@/modules/monitoring/TeamSnapshot';
import { CINEMATIC_HERO,FEDERAL_ONE_V2_URL,fmtDuration,fmtTime,initials,PROVIDER_URL,SUPABASE_URL } from "@/app/shared";
import type { ApplicationModel } from "@/app/useApplicationModel";
import { AdminSavedTransfersView } from "@/app/views/AdminSavedTransfersView";
import { CallLogView } from "@/app/views/CallLogView";
import { ContactsView } from "@/app/views/ContactsView";
import { ReportedMetrics } from "@/app/views/ReportedMetrics";
import { SectionHero } from "@/app/views/SectionHero";
import { SkeletonCard } from "@/app/views/SkeletonCard";
import { AdminCharts,GlassCard,GlowButton,InboundVerificationPanel,OwnerAlertOverview,queueToPillVariant,REDIAL_CAP,Reveal,StatusPill,TransferFunnel } from '@/components';
import { DialerControls } from '@/components/DialerControls';
import { OperationsDashboard } from '@/components/OperationsDashboard';
import { TestCallPanel } from '@/components/TestCallPanel';
import { fmtAttendanceDuration,presenceColor,presenceLabel } from '@/utils/attendance';
import { authFetch } from '@/utils/auth-fetch';
import { buildMonotonicFunnel,capAgentMonotonic,type FunnelData } from '@/utils/funnel';
import { formatPhone } from '@/utils/privacy';
import { transferMetricsForWindow } from '@/utils/transfer-metrics';
import {
Activity,
Check,
ChevronRight,CircleHelp,Clock,Download,FileText,FileUp,Flame,
LayoutDashboard,
Pause,Phone,PhoneOff,Play,RefreshCw,Search,
Settings,
ShieldCheck,
Square,
Upload,Users,
X,Zap
} from 'lucide-react';

export function OwnerDashboard({ model }: { model: Pick<ApplicationModel, "isOwner" | "adminStats" | "dialerLines" | "savingSpeed" | "togglingAgent" | "startingCampaign" | "stoppingCampaign" | "notice" | "speedNotice" | "handleDialerLines" | "toggleAgent" | "startCampaign" | "stopCampaign" | "activeNav" | "sessionToken" | "atomicLogout" | "setActiveNav" | "setExtraInfoPrefill" | "canControl" | "teamHealth" | "dashTab" | "setDashTab" | "transferProof" | "setTransferProofLoading" | "handleLogout" | "setTransferProof" | "perfView" | "setPerfView" | "displayPhone" | "togglePhoneReveal" | "rosterAttendance" | "rosterTimezone" | "revealedPhones" | "setConcurrency" | "settingConcurrency" | "liveActivity" | "redialProgresses" | "setRedialProgresses" | "removeRedialFromStorage" | "redialStats" | "redialStatsFilter" | "setRedialStatsFilter" | "redialTimeframe" | "setRedialTimeframe" | "redialingAgent" | "redialingHumans" | "redialSourceAgent" | "setRedialSourceAgent" | "dataHealth" | "openRedialModal" | "transferProofLoading" | "callLimit" | "setCallLimit" | "minuteCap" | "setMinuteCap" | "saveMinuteCap" | "savingCap" | "contactSearch" | "expandedContact" | "setExpandedContact" | "setPhoneAction" | "leadPool" | "handleUploadLeads" | "fileInputRef" | "importing" | "expandedCall" | "setExpandedCall" | "savedTransfers" | "allSavedTransfers" | "loadingAllSaved" | "loadAllSavedTransfers" | "allSavedTransfersError" > }) {
const { isOwner, adminStats, dialerLines, savingSpeed, togglingAgent, startingCampaign, stoppingCampaign, notice, speedNotice, handleDialerLines, toggleAgent, startCampaign, stopCampaign, activeNav, sessionToken, atomicLogout, setActiveNav, setExtraInfoPrefill, canControl, teamHealth, dashTab, setDashTab, transferProof, setTransferProofLoading, handleLogout, setTransferProof, perfView, setPerfView, displayPhone, togglePhoneReveal, rosterAttendance, rosterTimezone, revealedPhones, setConcurrency, settingConcurrency, liveActivity, redialProgresses, setRedialProgresses, removeRedialFromStorage, redialStats, redialStatsFilter, setRedialStatsFilter, redialTimeframe, setRedialTimeframe, redialingAgent, redialingHumans, redialSourceAgent, setRedialSourceAgent, dataHealth, openRedialModal, transferProofLoading, callLimit, setCallLimit, minuteCap, setMinuteCap, saveMinuteCap, savingCap, contactSearch, expandedContact, setExpandedContact, setPhoneAction, leadPool, handleUploadLeads, fileInputRef, importing, expandedCall, setExpandedCall, savedTransfers, allSavedTransfers, loadingAllSaved, loadAllSavedTransfers, allSavedTransfersError } = model;
return (<>
{isOwner && adminStats && <DialerControls agents={adminStats.agents} lines={dialerLines} activeCalls={adminStats.summary.active_call_count} reservedCalls={adminStats.summary.reserved_call_count} asOf={adminStats.summary.as_of}
            running={adminStats.summary.campaign_state === 'running'} saving={savingSpeed} changingAgent={togglingAgent}
            starting={startingCampaign} stopping={stoppingCampaign} notice={speedNotice}
            onLines={lines => void handleDialerLines(lines)} onAgent={(id, selected) => void toggleAgent(id, selected)}
            onStart={() => void startCampaign()} onStop={() => void stopCampaign()} />}
{isOwner && adminStats && adminStats.summary.dialer_status === 'waiting_for_agents' && (
            <div className="dialer-gated-banner">
              <Pause size={16} /> <strong>Dialing paused</strong> — no verified agent routes are selected. Check the team routes below.
            </div>
          )}
{isOwner && activeNav === 'test' && <TestCallPanel sessionToken={sessionToken} providerUrl={FEDERAL_ONE_V2_URL} onUnauthorized={atomicLogout} />}
{isOwner && activeNav === 'dashboard' && (
            <section className="f1-simple-home">
              <TeamSnapshot token={sessionToken} onOpen={()=>setActiveNav('monitoring')}/>
              <div className="f1-simple-actions">
                <button onClick={() => setActiveNav('test')}><Phone size={25} /><span><strong>Test a Call</strong><small>Choose an agent and check a transfer</small></span><ChevronRight size={18} /></button>
                <button className="extra-info-home-tile" onClick={() => { setExtraInfoPrefill(null); setActiveNav('extra'); }}><FileText size={25} /><span><strong>Extra Info</strong><small>Find more on a live call</small></span><ChevronRight size={18} /></button>
                <button onClick={() => setActiveNav('contacts')}><Search size={25} /><span><strong>Find a Client</strong><small>Name, phone, email, address, and more</small></span><ChevronRight size={18} /></button>
                <button onClick={() => setActiveNav('calls')}><Phone size={25} /><span><strong>See Calls</strong><small>Live calls, results, recordings, and notes</small></span><ChevronRight size={18} /></button>
                <button onClick={() => setActiveNav('opportunities')}><Users size={25} /><span><strong>Call Backs</strong><small>People who need attention</small></span><ChevronRight size={18} /></button>
                <button onClick={() => setActiveNav('system')}><Settings size={25} /><span><strong>Settings & Team</strong><small>Dialer, team, routes, and settings</small></span><ChevronRight size={18} /></button>
              </div>
              <div className="f1-simple-live">
                <span className={adminStats?.summary.campaign_state === 'running' ? 'online' : ''} />
                <div><small>DIALER</small><strong>{!adminStats ? 'Loading status…' : adminStats.summary.campaign_state === 'running' ? 'Running now' : 'Stopped'}</strong></div>
                <div><small>CALLS TODAY</small><strong>{adminStats?.summary.calls_attempted_today ?? '—'}</strong></div>
                <div><small>NEW LEADS</small><strong>{adminStats?.summary.leads_remaining ?? '—'}</strong></div>
                {canControl && adminStats && (adminStats.summary.campaign_state === 'running' ? <button onClick={stopCampaign} disabled={stoppingCampaign}><Pause size={16} />{stoppingCampaign ? 'Stopping…' : 'Stop Dialer'}</button> : <button onClick={startCampaign} disabled={startingCampaign}><Play size={16} />{startingCampaign ? 'Starting…' : 'Start Dialer'}</button>)}
              </div>
            </section>
          )}
{isOwner && ['dashboard', 'system'].includes(activeNav) && teamHealth && (
            <section className="f1-team-health" aria-label="System and team health">
              <div className="f1-health-service"><span className="ok" /><div><small>DATABASE</small><strong>Online</strong></div></div>
              <div className="f1-health-service"><span className={teamHealth.services.bland_api_key ? 'ok' : 'bad'} /><div><small>BLAND.AI</small><strong>{teamHealth.services.bland_api_key ? 'Connected' : 'Needs key'}</strong></div></div>
              <div className="f1-health-service"><span className={teamHealth.services.webhook_signature ? 'ok' : 'warn'} /><div><small>WEBHOOK SECURITY</small><strong>{teamHealth.services.webhook_signature ? 'Protected' : 'Needs secret'}</strong></div></div>
              {teamHealth.agents.map(agent => <div className="f1-health-agent" key={agent.id}>
                <span className={adminStats?.agents.find(a => a.id === agent.id)?.phone_ready ? 'ok' : 'warn'} />
                <div><small>{agent.full_name}</small><strong>{adminStats?.agents.find(a => a.id === agent.id)?.phone_ready ? 'Phone ready' : 'Phone not connected'} · {agent.route?.status === 'verified' ? 'Route ready' : 'Check route'}</strong></div>
              </div>)}
            </section>
          )}
{isOwner && ['dashboard', 'system'].includes(activeNav) && !adminStats && (
            <div className="stats-grid">
              <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          )}
{isOwner && ['dashboard', 'system'].includes(activeNav) && dashTab === 'overview' && (
            <OperationsDashboard sessionToken={sessionToken} providerUrl={FEDERAL_ONE_V2_URL} onUnauthorized={atomicLogout} />
          )}
{isOwner && ['dashboard', 'system'].includes(activeNav) && adminStats && (
            <>
              <details className="f1-all-metrics"><summary>All reported dialer statistics</summary><p>Reported values from the current statistics service. Missing billing amounts are not treated as zero.</p><ReportedMetrics value={adminStats} /></details>
              {/* Compact campaign status card */}
              <div className="campaign-status-card">
                <div className="campaign-status-left">
                  <div className={`campaign-status-badge ${adminStats.summary.campaign_state === 'running' ? 'running' : adminStats.summary.campaign_state === 'stopped' ? 'stopped' : 'unknown'}`}>
                    {adminStats.summary.campaign_state === 'running' ? <><span className="live-dot" /> RUNNING</> : adminStats.summary.campaign_state === 'stopped' ? 'STOPPED' : adminStats.summary.campaign_state.toUpperCase()}
                  </div>
                  <div className="campaign-status-info">
                    <strong>Dialer {adminStats.summary.campaign_state === 'running' ? 'Active' : 'Stopped'}</strong>
                    <span>{adminStats.summary.leads_remaining} leads remaining · {adminStats.summary.calls_attempted_today} calls today</span>
                  </div>
                </div>
                <div className="campaign-status-actions">
                  {canControl && (adminStats.summary.campaign_state === 'running' ? (
                    <GlowButton variant="rust" onClick={stopCampaign} disabled={stoppingCampaign}>
                      {stoppingCampaign ? <RefreshCw size={14} className="search-spinner" /> : <Pause size={14} />} {stoppingCampaign ? 'Stopping...' : 'Stop Dialer'}
                    </GlowButton>
                  ) : (
                    <GlowButton variant="sage" onClick={startCampaign} disabled={startingCampaign}>
                      {startingCampaign ? <RefreshCw size={14} className="search-spinner" /> : <Play size={14} />} {startingCampaign ? 'Starting…' : 'Start Dialer'}
                    </GlowButton>
                  ))}
                  <GlowButton variant="ghost" onClick={() => window.open(`${SUPABASE_URL}/functions/v1/wolf-dialer-report`, '_blank')}>
                    <FileText size={14} /> Report
                  </GlowButton>
                </div>
              </div>

              {adminStats.summary.blocking_reason?.includes('minute cap') && (
                <div className="toast minute-cap-banner">
                  <Clock size={16} /> <strong>Daily minute cap reached</strong> — the dialer was stopped automatically to protect your balance. It will resume tomorrow.
                </div>
              )}

              {/* Dashboard sub-tabs */}
              <div className="dash-tabs" role="tablist" aria-label="Dashboard sections">
                <button className={`dash-tab ${dashTab === 'overview' ? 'active' : ''}`} onClick={() => setDashTab('overview')} role="tab" aria-selected={dashTab === 'overview'}>
                  <LayoutDashboard size={14} /> Today
                </button>
                <button className={`dash-tab ${dashTab === 'agents' ? 'active' : ''}`} onClick={() => setDashTab('agents')} role="tab" aria-selected={dashTab === 'agents'}>
                  <Users size={14} /> Team
                </button>
                <button className={`dash-tab ${dashTab === 'redial' ? 'active' : ''}`} onClick={() => setDashTab('redial')} role="tab" aria-selected={dashTab === 'redial'}>
                  <Flame size={14} /> Call Again
                </button>
                {isOwner && <button className={`dash-tab ${dashTab === 'transfers' ? 'active' : ''}`} onClick={async () => { setDashTab('transfers'); if (!transferProof) { setTransferProofLoading(true); try { const tk = localStorage.getItem('sterling_session_token'); const r = await authFetch<{since:string;agents:Record<string,unknown>[];totals:Record<string,number>}>(PROVIDER_URL, { onUnauthorized: handleLogout, body: { action: 'get_transfer_proof', session_token: tk } }); if (r.ok && r.data) setTransferProof(r.data); } catch { /* transfer proof load */ } finally { setTransferProofLoading(false); } } }} role="tab" aria-selected={dashTab === 'transfers'}>
                  <ShieldCheck size={14} /> Transfer Check
                </button>}
                {canControl && <button className={`dash-tab ${dashTab === 'settings' ? 'active' : ''}`} onClick={() => setDashTab('settings')} role="tab" aria-selected={dashTab === 'settings'}>
                  <Settings size={14} /> Settings
                </button>}
              </div>

              {/* ── OVERVIEW TAB: KPI strip, corrected funnel, recent failures, agent readiness ── */}
              {dashTab === 'overview' && (
                <>

                  <details className="ops-details"><summary>Detailed transfer evidence &amp; routing checks</summary>
                  {/* Owner Alert Overview */}
                  <Reveal delay={200}>
                    <OwnerAlertOverview
                      sessionToken={sessionToken}
                      onUnauthorized={atomicLogout}
                      providerUrl={PROVIDER_URL}
                    />
                  </Reveal>

                  {/* Inbound Verification Panel */}
                  <Reveal delay={225}>
                    <InboundVerificationPanel
                      agents={adminStats.agents.filter(a => a.status === 'active' && a.bland_number).map(a => ({
                        id: a.id,
                        full_name: a.full_name,
                        bland_number: a.bland_number || '',
                        talkroute_number: a.talkroute_number || '',
                      }))}
                      providerUrl={PROVIDER_URL}
                      sessionToken={sessionToken}
                      onUnauthorized={atomicLogout}
                    />
                  </Reveal>

                  {/* Corrected Transfer Funnel */}

                  {adminStats.summary.funnel_today && (
                    <Reveal delay={250}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Activity size={12} /> TRANSFER FUNNEL</div>
                          <h3>Transfer evidence — recorded counts</h3>
                        </div>
                        <div className="funnel-time-toggle">
                          {(['today','week','all'] as const).map(t => (
                            <button key={t} className={`perf-tab ${perfView === t ? 'active' : ''}`} onClick={() => setPerfView(t)}>
                              {t === 'today' ? 'TODAY' : t === 'week' ? 'THIS WEEK' : 'ALL TIME'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {(() => {
                        const f = perfView === 'today' ? adminStats.summary.funnel_today : perfView === 'week' ? adminStats.summary.funnel_week : adminStats.summary.funnel_all;
                        if (!f) return null;
                        const s = adminStats.summary;
                        const metrics = transferMetricsForWindow(s, perfView);
                        const funnelData: FunnelData = {
                          calls_attempted: f.calls_attempted,
                          live_humans_reached: f.live_humans_reached,
                          transfers_requested: metrics.requested,
                          talkroute_dialed: metrics.dialed,
                          agent_answered: metrics.answered,
                          bridge_confirmed: metrics.bridged,
                          likely_real_conversation: f.likely_real_conversation,
                          transfer_failed_unverified: metrics.unverified,
                          data_quality_exceptions: 0,
                          total_minutes: f.total_minutes,
                          productive_minutes: f.productive_minutes,
                          wasted_minutes: f.wasted_minutes,
                          machine_minutes: f.machine_minutes,
                          avg_ai_leg_seconds: f.avg_ai_leg_seconds,
                          machines_detected: f.machines_detected,
                          avg_machine_seconds: f.avg_machine_seconds,
                        };
                        const { stages, exceptions, sideOutcome } = buildMonotonicFunnel(funnelData);
                        return <TransferFunnel stages={stages} exceptions={exceptions} sideOutcome={sideOutcome} />;
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Recent Transfer Failures (side outcome) */}
                  {adminStats.summary.errors_recent && adminStats.summary.errors_recent.length > 0 && (
                    <Reveal delay={300}>
                    <GlassCard hoverLift className="panel recent-failures-card">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><CircleHelp size={12} /> RECENT CALL ISSUES</div>
                          <h3>Call issues — latest 10</h3>
                        </div>
                      </div>
                      <div className="recent-failures-list">
                        {adminStats.summary.errors_recent.slice(0, 10).map((e, i) => {
                          const phoneDisplay = displayPhone(`err-${i}`, e.consumer_phone);
                          return (
                            <div key={i} className="recent-failure-row">
                              <span className="privacy-masked">{phoneDisplay.text}</span>
                              {phoneDisplay.masked && (
                                <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`err-${i}`)} aria-label="Reveal phone number">
                                  Reveal
                                </button>
                              )}
                              <span className="recent-failure-reason">{e.reason}</span>
                              <span className="recent-failure-time">{fmtTime(e.created_at)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Agent Readiness Summary */}
                  <Reveal delay={350}>
                  <GlassCard hoverLift className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><ShieldCheck size={12} /> AGENT READINESS</div>
                        <h3>Transfer-Certified Agent Status</h3>
                      </div>
                    </div>
                    <div className="agent-readiness-strip">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                        const ra = rosterAttendance.find(r => r.agent_id === agent.id);
                        const presence = ra?.presence || 'unknown';
                        const statusClass = presence === 'online' ? 'online' : presence === 'disconnected' ? 'warn' : 'offline';
                        return (
                          <div key={agent.id} className="agent-readiness-card">
                            <div className={`avatar ${presence === 'online' ? 'green' : presence === 'disconnected' ? 'amber' : 'gray'}`}>{initials(agent.full_name)}</div>
                            <div className="agent-readiness-info">
                              <strong>{agent.full_name}</strong>
                              <span>{agent.transfer_certified ? 'Certified' : 'Not certified'} · {agent.active_for_dialer ? 'Active' : 'Off'}</span>
                            </div>
                            <span className={`agent-readiness-status ${statusClass}`}>{presenceLabel(presence).toUpperCase()}</span>
                          </div>
                        );
                      })}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents. Ready when you are — activate an agent to begin.</div>
                      )}
                    </div>
                  </GlassCard>
                  </Reveal>
                  </details>
                </>
              )}

              {/* ── AGENTS TAB: agent activation, performance, login hours, live monitor ── */}
              {dashTab === 'agents' && (
                <>
                  {rosterAttendance.length > 0 && (() => {
                    const onlineCount = rosterAttendance.filter(r => r.presence === 'online').length;
                    const totalCount = rosterAttendance.length;
                    return (
                      <div className={`agents-live-panel ${onlineCount === 0 ? 'none-connected' : ''}`}>
                        <div className="agents-live-header">
                          <div className="agents-live-count">
                            <span className={`al-count-dot ${onlineCount > 0 ? 'live' : 'none'}`} />
                            <strong>{onlineCount} of {totalCount}</strong> agents online
                          </div>
                          <span style={{ fontSize: 10, color: 'var(--steel-400)' }}>Timezone: {rosterTimezone.replace('_', ' ')}</span>
                        </div>
                        <div className="agents-live-roster">
                          {rosterAttendance.map(ra => {
                            const agentRow = adminStats.agents.find(a => a.id === ra.agent_id);
                            const statusClass = ra.presence === 'online' ? 'connected' : ra.presence === 'disconnected' ? 'idle' : 'offline';
                            return (
                              <div key={ra.agent_id} className={`al-agent ${statusClass}`}>
                                <div className={`al-avatar ${statusClass}`}>{initials(ra.full_name)}</div>
                                <div className="al-info">
                                  <strong>{ra.full_name}</strong>
                                  <span className={`al-status ${statusClass}`}>
                                    <span className="al-mini-dot" style={{ background: presenceColor(ra.presence) }} />
                                    {presenceLabel(ra.presence).toUpperCase()}
                                    {ra.presence !== 'signed-out' && <> · Today: {fmtAttendanceDuration(ra.today_total_seconds)}</>}
                                    {ra.is_legacy_estimate && <span className="legacy-badge" title="Legacy estimate"> est</span>}
                                  </span>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--steel-400)', minWidth: 60 }}>
                                  {agentRow?.active_for_dialer ? 'Dialer ON' : 'Dialer OFF'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <Reveal delay={500}>
                  <GlassCard hoverLift className="panel agents-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Users size={12} /> AGENTS</div>
                        <h3>Agent Activation</h3>
                      </div>
                    </div>
                    <div className="agent-list">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => (
                        <div key={agent.id} className="agent-control-row">
                          <div className="agent-control-left">
                            <div className={`avatar ${agent.active_for_dialer ? 'green' : 'gray'}`}>
                              {initials(agent.full_name)}
                            </div>
                            <div className="agent-name">
                              <strong>{agent.full_name}</strong>
                              <span>•••• {agent.bland_number?.slice(-4)} → •••• {agent.talkroute_number?.slice(-4)}</span>
                              <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`agent-${agent.id}`)} aria-label={`Reveal phone numbers for ${agent.full_name}`}>
                                {revealedPhones.has(`agent-${agent.id}`) ? 'Hide' : 'Reveal'}
                              </button>
                              {revealedPhones.has(`agent-${agent.id}`) && (
                                <span className="agent-revealed-phones" style={{ display: 'block', fontSize: '10px', color: 'var(--steel-300)', marginTop: '2px' }}>
                                  {agent.bland_number} → {agent.talkroute_number}
                                </span>
                              )}
                            </div>
                          </div>
                          {canControl && (
                          <div className="agent-control-right">
                            <div className="direct-number-row direct-number-disabled">
                              <span className="direct-number-locked">
                                <PhoneOff size={12} /> Direct routing disabled — all transfers go through Zadarma
                              </span>
                            </div>
                            <div className="concurrency-selector">
                              <span className="concurrency-label">LINES:</span>
                              {[2, 3, 5, 7].map(n => (
                                <button key={n}
                                  className={`conc-btn ${agent.dialer_concurrency === n ? 'active' : ''}`}
                                  onClick={() => setConcurrency(agent.id, n)}
                                  disabled={settingConcurrency === agent.id}>
                                  {settingConcurrency === agent.id && agent.dialer_concurrency !== n ? '…' : n}
                                </button>
                              ))}
                            </div>
                            <button
                              className={`toggle-btn ${agent.active_for_dialer ? 'active' : ''}`}
                              onClick={() => toggleAgent(agent.id, agent.active_for_dialer)}
                              disabled={togglingAgent === agent.id}>
                              {togglingAgent === agent.id ? '...' : agent.active_for_dialer ? 'ACTIVE' : 'OFF'}
                            </button>
                          </div>
                          )}
                        </div>
                      ))}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents. Activate John or James to start dialing.</div>
                      )}

                      {/* Archived / Inactive agents */}
                      {adminStats.agents.filter(a => a.status !== 'active' && !a.role?.includes('owner')).length > 0 && (
                        <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
                          <div style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.05em', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>Archived / Inactive</div>
                          {adminStats.agents.filter(a => a.status !== 'active' && !a.role?.includes('owner')).map(agent => (
                            <div key={agent.id} className="agent-control-row" style={{ opacity: 0.55 }}>
                              <div className="agent-control-left">
                                <div className="avatar gray">{initials(agent.full_name)}</div>
                                <div className="agent-name">
                                  <strong>{agent.full_name}</strong>
                                  <span style={{ fontSize: '10px', color: '#ef4444' }}>
                                    {agent.status === 'archived' ? 'ARCHIVED' : 'INACTIVE'} — {agent.outbound_attempts_all ?? 0} total calls, {agent.bridge_confirmed_all ?? 0} bridges
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </GlassCard>
                  </Reveal>

                  {/* Agent Performance */}
                  <div className="panel perf-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Users size={12} /> COMMAND CENTER</div>
                        <h3>Agent Performance</h3>
                      </div>
                      <div className="perf-toggle">
                        <button className={`perf-tab ${perfView === 'today' ? 'active' : ''}`} onClick={() => setPerfView('today')}>TODAY</button>
                        <button className={`perf-tab ${perfView === 'week' ? 'active' : ''}`} onClick={() => setPerfView('week')}>THIS WEEK</button>
                        <button className={`perf-tab ${perfView === 'all' ? 'active' : ''}`} onClick={() => setPerfView('all')}>ALL TIME</button>
                      </div>
                    </div>
                    <div className="perf-table-wrap">
                      <table className="perf-table">
                        <thead>
                          <tr>
                            <th>AGENT</th>
                            <th className="num-col">CALLS</th>
                            <th className="num-col">LIVE</th>
                            <th className="num-col">DROPS</th>
                            <th className="num-col">TRANSFERS</th>
                            <th className="num-col handed-off-col">BRIDGED</th>
                            <th className="num-col">NO ANS.</th>
                            <th className="num-col">VOICEMAIL</th>
                            <th className="num-col">CONNECT %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                            const d = perfView === 'today';
                            const all = perfView === 'all';
                            const rawCalls = d ? agent.outbound_attempts_today : all ? (agent.outbound_attempts_all ?? 0) : agent.outbound_attempts_week;
                            const rawLive = d ? agent.live_humans : all ? (agent.live_humans_all ?? 0) : agent.live_humans_week;
                            const rawTransfers = (d ? agent.transfers_requested_today : all ? agent.transfers_requested_all : agent.transfers_requested_week) ?? 0;
                            const rawBridged = d ? (agent.bridge_confirmed_today ?? 0) : all ? (agent.bridge_confirmed_all ?? 0) : (agent.bridge_confirmed_week ?? 0);
                            const capped = capAgentMonotonic({ calls_attempted: rawCalls, live_humans: rawLive, transfers_requested: rawTransfers, bridge_confirmed: rawBridged });
                            const drops = d ? agent.human_drops : all ? agent.human_drops_all : agent.human_drops_week;
                            const noAns = d ? agent.no_answers : all ? agent.no_answers_all : agent.no_answers_week;
                            const vm = d ? agent.voice_messages : all ? agent.voice_messages_all : agent.voice_messages_week;
                            const connectRate = capped.attempted > 0 ? Math.round((capped.live / capped.attempted) * 100) : 0;
                            return (
                              <tr key={agent.id}>
                                <td className="agent-cell">
                                  <div className={`avatar green perf-avatar`}>{initials(agent.full_name)}</div>
                                  <strong>{agent.full_name}</strong>
                                  {capped.exceptions > 0 && <span className="agent-dq-badge" title={`${capped.exceptions} stage-count differences — totals are shown without reduction`}>DQ:{capped.exceptions}</span>}
                                </td>
                                <td className="num-col">{capped.attempted}</td>
                                <td className="num-col">{capped.live}</td>
                                <td className="num-col">{drops}</td>
                                <td className="num-col transfers-cell">{capped.transfers}</td>
                                <td className="num-col handed-off-cell"><strong>{capped.bridged}</strong></td>
                                <td className="num-col">{noAns}</td>
                                <td className="num-col">{vm}</td>
                                <td className="num-col">
                                  <div className="connect-bar-wrap">
                                    <div className="connect-bar" style={{ width: `${connectRate}%` }} />
                                    <span>{connectRate}%</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                            <tr><td colSpan={9} className="empty-state">No active agents.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="perf-note">
                      {perfView === 'today' ? 'Today begins at midnight Costa Rica time.' : perfView === 'week' ? 'This week begins Monday at midnight Costa Rica time.' : 'All available accepted outbound calls.'}
                    </div>
                  </div>

                  {/* Attendance (heartbeat-based) */}
                  {rosterAttendance.length > 0 && (
                    <Reveal delay={550}>
                    <GlassCard hoverLift className="panel login-hours-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Clock size={12} /> AGENT ATTENDANCE</div>
                          <h3>Connected App Time — Resets Every Monday ({rosterTimezone.replace('_', ' ')})</h3>
                        </div>
                        <span className="perf-tab active">THIS WEEK</span>
                      </div>
                      <div className="login-hours-table-wrap">
                        <table className="live-monitor-table login-hours-table">
                          <thead>
                            <tr>
                              <th>AGENT</th>
                              <th>STATUS</th>
                              <th className="num-col">TODAY</th>
                              <th className="num-col">THIS WEEK</th>
                              <th>DIALER</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rosterAttendance.map(ra => (
                              <tr key={ra.agent_id} className={`lh-row ${ra.presence === 'online' ? 'lh-logged-in' : 'lh-logged-off'}`}>
                                <td className="lh-agent">
                                  <div className={`avatar ${ra.presence === 'online' ? 'green' : ra.presence === 'disconnected' ? 'amber' : 'gray'}`}>
                                    {initials(ra.full_name)}
                                  </div>
                                  <strong>{ra.full_name}</strong>
                                </td>
                                <td>
                                  <span className={`lh-status-badge ${ra.presence === 'online' ? 'online' : ra.presence === 'disconnected' ? 'warn' : 'offline'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: presenceColor(ra.presence) }} />
                                    {presenceLabel(ra.presence).toUpperCase()}
                                    {ra.is_legacy_estimate && <span className="legacy-badge" title="Legacy estimate — pre-heartbeat session data"> est</span>}
                                  </span>
                                </td>
                                <td className="num-col lh-today">{fmtAttendanceDuration(ra.today_total_seconds)}</td>
                                <td className="num-col lh-week"><strong>{fmtAttendanceDuration(ra.week_total_seconds)}</strong></td>
                                <td>{ra.active_for_dialer ? 'Active' : 'Off'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="perf-note">
                        Connected app time, NOT proof of productive work. Historical sessions before heartbeat are labeled "est" (legacy estimate).
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Live Call Monitor */}
                  {liveActivity && liveActivity.recent_50 && (
                    <Reveal delay={450}>
                    <GlassCard hoverLift className="panel live-monitor-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Activity size={12} /> LIVE CALL MONITOR</div>
                          <h3>Last 50 Accepted Calls</h3>
                        </div>
                        <div className="live-monitor-summary">
                          <span className="lms-pill"><Flame size={11} className="fire-icon" /> {liveActivity.outcome_breakdown?.bridged ?? 0} confirmed bridges</span>
                          <span className="lms-pill"><Users size={11} /> {liveActivity.outcome_breakdown?.human_drop ?? 0} drops</span>
                          <span className="lms-pill">{liveActivity.outcome_breakdown?.no_answer ?? 0} no-answer</span>
                          <span className="lms-pill">{liveActivity.outcome_breakdown?.voice_message ?? 0} voicemail</span>
                          <span className="lms-pill lms-connect">Human rate: {liveActivity.connect_rate == null ? '—' : `${liveActivity.connect_rate}%`}</span>
                          <span className="lms-pill">Avg completed human call: {fmtDuration(liveActivity.avg_duration_seconds)}</span>
                        </div>
                      </div>
                      <div className="live-monitor-table-wrap">
                        <table className="live-monitor-table">
                          <thead>
                            <tr>
                              <th>TIME</th>
                              <th>NAME</th>
                              <th>PHONE</th>
                              <th>AGENT</th>
                              <th>OUTCOME</th>
                              <th className="num-col">DURATION</th>
                              <th>TRANSFER</th>
                              <th>AI STOP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {liveActivity.recent_50.slice(0, 50).map((c) => {
                              const phoneDisplay = displayPhone(`lm-${c.id}`, c.consumer_phone);
                              return (
                                <tr key={c.id} className={`lm-row lm-${c.queue}`}>
                                  <td className="lm-time">
                                    <span className="lm-seconds">{c.seconds_ago < 60 ? `${c.seconds_ago}s ago` : `${Math.floor(c.seconds_ago / 60)}m ago`}</span>
                                    <span className="lm-clock">{fmtTime(c.created_at)}</span>
                                  </td>
                                  <td className="lm-name">{c.consumer_name || 'Unknown'}</td>
                                  <td className="lm-phone">
                                    <span className="privacy-masked">{phoneDisplay.text}</span>
                                    {phoneDisplay.masked && c.consumer_phone && (
                                      <button className="privacy-reveal-btn" onClick={() => togglePhoneReveal(`lm-${c.id}`)} aria-label="Reveal phone">Reveal</button>
                                    )}
                                  </td>
                                  <td className="lm-agent">{c.agent_name || '—'}</td>
                                  <td><StatusPill variant={queueToPillVariant(c.queue)} /></td>
                                  <td className="num-col lm-dur">{fmtDuration(c.duration_seconds)}</td>
                                  <td className="lm-transfer">
                                    {c.transfer_status && c.transfer_status !== 'none' ? (
                                      <span className={`lm-tag ${c.transfer_status === 'completed' ? 'lm-tag-ok' : 'lm-tag-pending'}`}>{c.transfer_status}</span>
                                    ) : <span className="lm-dash">—</span>}
                                  </td>
                                  <td className="lm-ai-stop">
                                    {c.ai_terminated ? <Check size={14} className="lm-check" /> : <span className="lm-dash">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                            {liveActivity.recent_50.length === 0 && (
                              <tr><td colSpan={8} className="empty-state">No calls yet. The dialer will populate this feed as calls complete.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </GlassCard>
                    </Reveal>
                  )}

                  <AdminCharts sessionToken={sessionToken} onUnauthorized={atomicLogout} />
                </>
              )}

              {/* ── REDIAL TAB: redial panel with safety gates ── */}
              {dashTab === 'redial' && (
                <>
                  <div className="panel redial-panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow flame-eyebrow"><Flame size={12} /> RE-DIAL CONTROL</div>
                        <h3>Re-Dial Live Transfers &amp; Live Humans</h3>
                      </div>
                      <div className="perf-toggle">
                        <span className="perf-tab active">THIS WEEK</span>
                      </div>
                    </div>
                    <p className="redial-subtitle">Max {REDIAL_CAP} records per batch. Two-step confirmation required. Disabled when campaign is active.</p>
                    {redialProgresses.map(rp => (
                      <div key={rp.batchId} className={`redial-progress-bar ${rp.type === 'humans' ? 'humans-progress' : ''}`}>
                        <div className="redial-progress-header">
                          <div className="redial-progress-title">
                            <RefreshCw size={14} className="search-spinner" />
                            <strong>Re-dialing {rp.type === 'humans' ? 'Live Humans' : 'Live Transfers'} for {rp.agentName}</strong>
                            {rp.pollData && rp.pollData.dialing === 0 && rp.pollData.pending === 0 && (
                              <span className="rp-done-badge">COMPLETE</span>
                            )}
                          </div>
                          <button className="redial-progress-close" onClick={() => { setRedialProgresses(prev => prev.filter(p => p.batchId !== rp.batchId)); removeRedialFromStorage(rp.batchId); }}>
                            <X size={14} />
                          </button>
                        </div>
                        <div className="redial-progress-stats">
                          <div className="rp-stat"><span className="rp-stat-label">DIALING</span><span className="rp-stat-value">{rp.pollData?.dialing ?? '—'}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">PLACED</span><span className="rp-stat-value">{rp.pollData?.withCallId ?? rp.dialed}</span></div>
                          <div className="rp-stat rp-stat-transfer"><span className="rp-stat-label">CONFIRMED BRIDGES</span><span className="rp-stat-value">{rp.pollData?.transfers ?? 0}</span></div>
                          <div className="rp-stat rp-stat-human"><span className="rp-stat-label">LIVE HUMANS</span><span className="rp-stat-value">{rp.pollData?.liveHumans ?? 0}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">VOICEMAILS</span><span className="rp-stat-value">{rp.pollData?.voicemails ?? 0}</span></div>
                          <div className="rp-stat rp-stat-fail"><span className="rp-stat-label">FAILED</span><span className="rp-stat-value">{rp.pollData?.failed ?? rp.failed}</span></div>
                          <div className="rp-stat"><span className="rp-stat-label">TOTAL</span><span className="rp-stat-value">{rp.total}</span></div>
                        </div>
                        <div className="redial-progress-track">
                          <div className={`redial-progress-fill ${rp.type === 'humans' ? 'humans-fill' : ''}`} style={{ width: `${rp.total > 0 ? Math.round(((rp.pollData?.withCallId ?? rp.dialed) / rp.total) * 100) : 0}%` }} />
                        </div>
                        {rp.calls.length > 0 && (
                          <div className="rp-calls-list">
                            {rp.calls.map(c => {
                              const statusLabel = c.queue === 'fire_transfer' ? 'TRANSFERRED' : c.queue === 'human_drop' ? 'LIVE HUMAN' : c.queue === 'no_answer' ? 'NO ANSWER' : c.queue === 'voice_message' ? 'VOICEMAIL' : c.queue === 'pending' ? 'AWAITING COMPLETION' : c.queue.toUpperCase();
                              const statusClass = c.queue === 'fire_transfer' ? 'rpc-transfer' : c.queue === 'human_drop' ? 'rpc-human' : c.queue === 'no_answer' ? 'rpc-noans' : c.queue === 'voice_message' ? 'rpc-vm' : c.queue === 'pending' ? 'rpc-dialing' : 'rpc-other';
                              return (
                                <div key={c.id} className={`rp-call-row ${statusClass}`}>
                                  <span className="rpc-name">{c.name || 'Unknown'}</span>
                                  <span className="rpc-phone">{formatPhone(c.phone)}</span>
                                  <span className="rpc-status">{statusLabel}</span>
                                  <span className="rpc-duration">{c.duration_seconds > 0 ? `${Math.round(c.duration_seconds)}s` : '—'}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Redial Analytics */}
                    {redialStats && redialStats.overall.total_batches > 0 && (
                      <div className="redial-analytics">
                        <div className="redial-analytics-header">
                          <div className="eyebrow"><Activity size={12} /> REDIAL ANALYTICS</div>
                          <div className="redial-filter-tabs">
                            <button className={`redial-filter-tab ${redialStatsFilter === 'all' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('all')}>ALL ({redialStats.overall.total_batches})</button>
                            <button className={`redial-filter-tab ${redialStatsFilter === 'active' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('active')}>ACTIVE ({redialStats.overall.active_batches})</button>
                            <button className={`redial-filter-tab ${redialStatsFilter === 'completed' ? 'active' : ''}`} onClick={() => setRedialStatsFilter('completed')}>COMPLETED ({redialStats.overall.total_batches - redialStats.overall.active_batches})</button>
                          </div>
                        </div>
                        <div className="redial-overall-grid">
                          <div className="redial-stat-card"><span className="rs-label">REDIAL RECORDS</span><span className="rs-value">{redialStats.overall.total_calls}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">ACCEPTED</span><span className="rs-value">{redialStats.overall.total_placed}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">HUMAN-CLASSIFIED</span><span className="rs-value">{redialStats.overall.total_answered}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">NO ANSWER</span><span className="rs-value">{redialStats.overall.total_no_answer}</span></div>
                          <div className="redial-stat-card rs-transfer"><Flame size={14} className="fire-icon" /><span className="rs-label">TRANSFER REQUESTED</span><span className="rs-value">{redialStats.overall.total_transfer_requested}</span></div>
                          <div className="redial-stat-card rs-success"><Check size={14} /><span className="rs-label">PROVIDER-CONFIRMED BRIDGES</span><span className="rs-value">{redialStats.overall.total_transfer_successful}</span></div>
                          <div className="redial-stat-card rs-fail"><X size={14} /><span className="rs-label">FAILED TRANSFERS</span><span className="rs-value">{redialStats.overall.total_transfer_failed}</span></div>
                          <div className="redial-stat-card"><Users size={14} /><span className="rs-label">LIVE HUMANS</span><span className="rs-value">{redialStats.overall.total_live_humans}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">FAILURES</span><span className="rs-value">{redialStats.overall.total_failed}</span></div>
                          <div className="redial-stat-card"><span className="rs-label">MINUTES USED</span><span className="rs-value">{redialStats.overall.total_minutes}</span></div>
                        </div>
                        <div className="redial-batch-table-wrap">
                          <table className="redial-batch-table">
                            <thead>
                              <tr>
                                <th>BATCH</th>
                                <th>AGENT</th>
                                <th>TYPE</th>
                                <th className="num-col">TOTAL</th>
                                <th className="num-col">PLACED</th>
                                <th className="num-col">TRANSFER REQ</th>
                                <th className="num-col">BRIDGED</th>
                                <th className="num-col">FAILED</th>
                                <th>STATUS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {redialStats.batches.filter(b => redialStatsFilter === 'all' || (redialStatsFilter === 'active' && b.is_active) || (redialStatsFilter === 'completed' && !b.is_active)).map(batch => (
                                <tr key={`${batch.batch_id}:${batch.agent_id}`} className={`rb-row ${batch.is_active ? 'rb-active' : ''}`}>
                                  <td className="rb-batch-id">{batch.batch_id.slice(0, 8)}...</td>
                                  <td className="rb-agent">{batch.agent_name}</td>
                                  <td className="rb-type">{batch.type === 'transfers' ? 'Transfer' : batch.type === 'humans' ? 'Human' : batch.type === 'agent_selected' ? 'Agent' : 'Unspecified'}</td>
                                  <td className="num-col">{batch.total}</td>
                                  <td className="num-col">{batch.placed}</td>
                                  <td className="num-col rb-transfer-req">{batch.transfer_requested}</td>
                                  <td className="num-col rb-success">{batch.transfer_successful}</td>
                                  <td className="num-col rb-fail">{batch.transfer_failed}</td>
                                  <td><span className={`rb-status ${batch.is_active ? 'rb-status-active' : 'rb-status-done'}`}>{batch.is_active ? 'ACTIVE' : 'DONE'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="redial-timeframe-bar">
                      <span className="redial-timeframe-label">Timeframe:</span>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'today' ? 'active' : ''}`} onClick={() => setRedialTimeframe('today')}>Today</button>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'week' ? 'active' : ''}`} onClick={() => setRedialTimeframe('week')}>This Week</button>
                      <button className={`redial-timeframe-btn ${redialTimeframe === 'all' ? 'active' : ''}`} onClick={() => setRedialTimeframe('all')}>All Time</button>
                    </div>

                    <div className="redial-agent-list">
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).map(agent => {
                        const tf = redialTimeframe;
                        const attempts = tf === 'today' ? agent.outbound_attempts_today : tf === 'week' ? agent.outbound_attempts_week : (agent.outbound_attempts_all ?? 0);
                        const liveHumans = tf === 'today' ? agent.live_humans : tf === 'week' ? agent.live_humans_week : (agent.live_humans_all ?? 0);
                        const transfersReq = tf === 'today' ? agent.transfers_requested_today : tf === 'week' ? (agent.transfers_requested_week ?? 0) : (agent.transfers_requested_all ?? 0);
                        const talkrouteLeg = tf === 'today' ? (agent.talkroute_leg_created_today ?? 0) : tf === 'week' ? (agent.talkroute_leg_created_week ?? 0) : (agent.talkroute_leg_created_all ?? 0);
                        const talkrouteAns = tf === 'today' ? agent.talkroute_answered_today : tf === 'week' ? (agent.talkroute_answered_week ?? 0) : (agent.talkroute_answered_all ?? 0);
                        const bridgeConf = tf === 'today' ? agent.bridge_confirmed_today : tf === 'week' ? (agent.bridge_confirmed_week ?? 0) : (agent.bridge_confirmed_all ?? 0);
                        const fireTransfers = tf === 'today' ? agent.fire_transfers : tf === 'week' ? agent.fire_transfers_week : (agent.fire_transfers_all ?? 0);
                        const isDialingTransfers = redialingAgent === agent.id;
                        const isDialingHumans = redialingHumans === agent.id;
                        const sourceId = redialSourceAgent[agent.id] || agent.id;
                        const sourceAgent = adminStats.agents.find(a => a.id === sourceId);
                        const sourceTransfers = tf === 'today' ? (sourceAgent?.fire_transfers ?? 0) : tf === 'week' ? (sourceAgent?.fire_transfers_week ?? 0) : (sourceAgent?.fire_transfers_all ?? 0);
                        const sourceLiveHumans = tf === 'today' ? (sourceAgent?.live_humans ?? 0) : tf === 'week' ? (sourceAgent?.live_humans_week ?? 0) : (sourceAgent?.live_humans_all ?? 0);
                        const otherAgents = adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner') && a.id !== agent.id);
                        const campaignActive = adminStats.summary.campaign_state === 'running';
                        const tfLabel = tf === 'today' ? 'today' : tf === 'week' ? 'this week' : 'all-time';
                        return (
                          <div key={agent.id} className={`redial-agent-card ${(fireTransfers > 0 || liveHumans > 0) ? 'has-transfers' : ''} ${(isDialingTransfers || isDialingHumans) ? 'dialing' : ''}`}>
                            <div className="redial-agent-info">
                              <div className={`avatar ${agent.active_for_dialer ? 'green' : 'gray'}`}>{initials(agent.full_name)}</div>
                              <div className="redial-agent-text">
                                <strong>{agent.full_name}</strong>
                                <div className="redial-historical-grid">
                                  <span className="rh-stat"><Activity size={11} /> {attempts} attempts</span>
                                  <span className="rh-stat"><Users size={11} /> {liveHumans} live humans</span>
                                  <span className="rh-stat"><Flame size={11} /> {transfersReq} transfer req.</span>
                                  <span className="rh-stat"><Phone size={11} /> {talkrouteLeg} Zadarma dialed</span>
                                  <span className="rh-stat"><Check size={11} /> {talkrouteAns} destination answer reported</span>
                                  <span className="rh-stat bridge"><ShieldCheck size={11} /> {bridgeConf} bridge confirmed</span>
                                </div>
                                <div className="redial-stats">
                                  <span className="redial-count"><Flame size={13} className="fire-icon" /> {fireTransfers} transfer{fireTransfers !== 1 ? 's' : ''} <span className="redial-period">({tfLabel})</span></span>
                                  <span className="redial-count humans-count"><Users size={13} /> {liveHumans} live human{liveHumans !== 1 ? 's' : ''} <span className="redial-period">({tfLabel})</span></span>
                                </div>
                                {otherAgents.length > 0 && (
                                  <div className="redial-source-row">
                                    <label className="redial-source-label">Dial contacts from:</label>
                                    <select className="redial-source-select" value={sourceId} onChange={e => setRedialSourceAgent(prev => ({ ...prev, [agent.id]: e.target.value }))}>
                                      <option value={agent.id}>{agent.full_name} (own)</option>
                                      {otherAgents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="redial-actions">
                              <button
                                className={`redial-action-btn ${sourceTransfers > 0 ? 'has-transfers' : ''} ${isDialingTransfers ? 'dialing' : ''}`}
                                disabled={sourceTransfers === 0 || isDialingTransfers || campaignActive || dataHealth.status !== 'healthy'}
                                onClick={() => openRedialModal('transfers', agent.id, agent.full_name, sourceId !== agent.id ? sourceId : undefined)}
                              >
                                {isDialingTransfers ? <><RefreshCw size={16} className="search-spinner" /> DIALING...</> : sourceTransfers > 0 ? <><Flame size={16} /> PREVIEW TRANSFER REDIAL</> : <>NO TRANSFERS</>}
                              </button>
                              <button
                                className={`redial-action-btn humans-btn ${sourceLiveHumans > 0 ? 'has-humans' : ''} ${isDialingHumans ? 'dialing' : ''}`}
                                disabled={sourceLiveHumans === 0 || isDialingHumans || campaignActive || dataHealth.status !== 'healthy'}
                                onClick={() => openRedialModal('humans', agent.id, agent.full_name, sourceId !== agent.id ? sourceId : undefined)}
                              >
                                {isDialingHumans ? <><RefreshCw size={16} className="search-spinner" /> DIALING...</> : sourceLiveHumans > 0 ? <><Phone size={16} /> PREVIEW HUMAN REDIAL</> : <>NO LIVE HUMANS</>}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {adminStats.agents.filter(a => a.status === 'active' && !a.role?.includes('owner')).length === 0 && (
                        <div className="empty-state">No active agents.</div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* ── SETTINGS TAB: call limit, minute cap, machine waste ── */}
              {dashTab === 'transfers' && (
                <div className="glass-card" style={{ padding: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <ShieldCheck size={18} /> Transfer Proof Ledger
                    </h3>
                    <button className="btn-ghost" style={{ fontSize: '.8rem' }} onClick={async () => { setTransferProofLoading(true); try { const tk = localStorage.getItem('sterling_session_token'); const r = await authFetch<{since:string;agents:Record<string,unknown>[];totals:Record<string,number>}>(PROVIDER_URL, { onUnauthorized: handleLogout, body: { action: 'get_transfer_proof', session_token: tk } }); if (r.ok && r.data) setTransferProof(r.data); } catch { /* transfer proof refresh */ } finally { setTransferProofLoading(false); } }}>
                      <RefreshCw size={12} className={transferProofLoading ? 'search-spinner' : ''} /> Refresh
                    </button>
                  </div>
                  {transferProofLoading && !transferProof && <p style={{ opacity: .6, textAlign: 'center', padding: '2rem 0' }}>Loading transfer evidence...</p>}
                  {transferProof && (
                    <>
                      <p style={{ fontSize: '.78rem', opacity: .5, marginBottom: '1rem' }}>Since {new Date(transferProof.since).toLocaleString()}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '.75rem', marginBottom: '1.5rem' }}>
                        {[
                          { label: 'Total Outbound', val: transferProof.totals?.total_outbound ?? 0 },
                          { label: 'Transfer Req', val: transferProof.totals?.transfer_requested ?? 0 },
                          { label: 'Zadarma Dialed', val: transferProof.totals?.talkroute_dialed ?? 0 },
                          { label: 'Destination Answer Reported', val: transferProof.totals?.talkroute_answered ?? 0 },
                          { label: 'Rep Speech', val: transferProof.totals?.rep_speech_detected ?? 0 },
                          { label: 'Bridge Confirmed', val: transferProof.totals?.bridge_confirmed ?? 0 },
                          { label: 'Transfer Failed', val: transferProof.totals?.transfer_failed ?? 0 },
                          { label: 'Drops Classified', val: transferProof.totals?.classified_drops ?? 0 },
                        ].map(k => (
                          <div key={k.label} className="glass-card" style={{ padding: '.75rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{k.val}</div>
                            <div style={{ fontSize: '.7rem', opacity: .6, marginTop: '.15rem' }}>{k.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.1)', textAlign: 'left' }}>
                              <th style={{ padding: '.5rem .4rem', fontWeight: 600 }}>Agent</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Outbound</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Transfer Req</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>TR Dialed</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>TR Answered</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Rep Speech</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Bridge</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Failed</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>Live Humans</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>No Answer</th>
                              <th style={{ padding: '.5rem .4rem', textAlign: 'right' }}>VM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(transferProof.agents || []).map((ag: Record<string, unknown>) => (
                              <tr key={String(ag.agent_id)} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                                <td style={{ padding: '.45rem .4rem', fontWeight: 500 }}>{String(ag.agent_name)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.total_outbound)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.transfer_requested)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.talkroute_dialed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.talkroute_answered)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.rep_speech_detected)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right', color: Number(ag.bridge_confirmed) > 0 ? '#22c55e' : 'inherit' }}>{Number(ag.bridge_confirmed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right', color: Number(ag.transfer_failed) > 0 ? '#ef4444' : 'inherit' }}>{Number(ag.transfer_failed)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.live_humans)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.no_answer)}</td>
                                <td style={{ padding: '.45rem .4rem', textAlign: 'right' }}>{Number(ag.voicemail)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {dashTab === 'settings' && (
                <>
                  {/* Minutes / Cost */}
                  {adminStats.summary.funnel_today && (
                    <Reveal delay={300}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Clock size={12} /> MINUTES &amp; COST</div>
                          <h3>Recorded call duration</h3>
                        </div>
                        <span className="perf-tab active">{perfView === 'today' ? 'TODAY' : perfView === 'week' ? 'THIS WEEK' : 'ALL TIME'}</span>
                      </div>
                      {(() => {
                        const f = perfView === 'today' ? adminStats.summary.funnel_today! : perfView === 'week' ? adminStats.summary.funnel_week! : adminStats.summary.funnel_all!;
                        if (!f) return null;
                        return (
                          <div className="minutes-grid">
                            <div className="minute-card total"><span className="minute-label">TOTAL OUTBOUND MINUTES</span><span className="minute-value">{f.total_minutes}</span></div>
                            <div className="minute-card productive"><span className="minute-label">KNOWN POST-BRIDGE MINUTES</span><span className="minute-value">{f.productive_minutes}</span></div>
                            <div className="minute-card wasted"><span className="minute-label">NO ANSWER / MACHINES</span><span className="minute-value">{f.wasted_minutes}</span></div>
                            <div className="minute-card machine"><span className="minute-label">ON MACHINES</span><span className="minute-value">{f.machine_minutes}</span></div>
                            <div className="minute-card avg-ai"><span className="minute-label">AVG COMPLETED CALL</span><span className="minute-value">{f.avg_ai_leg_seconds}s</span></div>
                          </div>
                        );
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Machine Waste */}
                  {adminStats.summary.funnel_today && (
                    <Reveal delay={350}>
                    <GlassCard hoverLift className="panel observability-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="eyebrow"><Square size={12} /> MACHINE-WASTE VISIBILITY</div>
                          <h3>Answering Machine Detection</h3>
                        </div>
                      </div>
                      {(() => {
                        const f = adminStats.summary.funnel_today!;
                        if (!f) return null;
                        const slow = f.avg_machine_seconds > 8;
                        return (
                          <div className="machine-waste-row">
                            <div className="mw-stat"><span className="mw-label">MACHINES DETECTED</span><span className="mw-value">{f.machines_detected}</span></div>
                            <div className="mw-stat"><span className="mw-label">AVG MACHINE SECONDS</span><span className={`mw-value ${slow ? 'mw-slow' : ''}`}>{f.avg_machine_seconds}s</span></div>
                            {slow && <div className="mw-warning"><Zap size={14} /> Avg machine call is {f.avg_machine_seconds}s — machine-drop rule may be too slow (should be ~8s or less).</div>}
                          </div>
                        );
                      })()}
                    </GlassCard>
                    </Reveal>
                  )}

                  {/* Call Limit */}
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Zap size={12} /> CAMPAIGN SETTINGS</div>
                        <h3>Call Limit</h3>
                      </div>
                    </div>
                    <div className="call-limit-row">
                      <label>Maximum calls for this campaign:</label>
                      <input type="number" className="call-limit-input" value={callLimit} onChange={e => setCallLimit(parseInt(e.target.value) || 100)} min={1} />
                      <span className="call-limit-hint">The dialer stops automatically when this limit is reached.</span>
                    </div>
                  </div>

                  {/* Daily Minute Cap */}
                  <div className="panel">
                    <div className="panel-heading">
                      <div>
                        <div className="eyebrow"><Clock size={12} /> BALANCE PROTECTION</div>
                        <h3>Daily Minute Cap</h3>
                      </div>
                    </div>
                    <div className="call-limit-row">
                      <label>Max connected minutes per day:</label>
                      <input type="number" className="call-limit-input" value={minuteCap ?? ''} onChange={e => setMinuteCap(e.target.value ? parseInt(e.target.value) : null)} min={0} placeholder="Off" />
                      <span className="call-limit-hint">
                        {adminStats?.summary?.daily_minutes_used != null && <>Today: <strong style={{ color: 'var(--gold-300)' }}>{adminStats.summary.daily_minutes_used} min</strong> used</>}
                        {minuteCap && adminStats?.summary?.daily_minutes_used != null && <> · <strong style={{ color: minuteCap > 0 && adminStats.summary.daily_minutes_used >= minuteCap ? 'var(--rust-400)' : 'var(--sage-400)' }}>{minuteCap > 0 && adminStats.summary.daily_minutes_used >= minuteCap ? 'CAP REACHED' : `${Math.round((adminStats.summary.daily_minutes_used / minuteCap) * 100)}%`}</strong></>}
                      </span>
                    </div>
                    <div style={{ marginTop: '12px' }}>
                      <GlowButton onClick={saveMinuteCap} disabled={savingCap}>{savingCap ? 'Saving...' : 'Save Cap'}</GlowButton>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
{isOwner && activeNav === 'contacts' && (
            <ContactsView {...contactSearch}
              expandedContact={expandedContact} setExpandedContact={setExpandedContact}
              sessionToken={sessionToken}
              onPhoneClick={(name, phone, email, address) => setPhoneAction({ name, phone, email, address })}
              onUnauthorized={atomicLogout}
              onNavTo={setActiveNav}
              onExtraInfo={(p) => { setExtraInfoPrefill(p); setActiveNav('extra'); }}
            />
          )}
{isOwner && activeNav === 'leads' && (
            <>
              <SectionHero image={CINEMATIC_HERO.commandCenter} eyebrow="LEAD MANAGEMENT" title="Upload Leads" subtitle="Upload a CSV file with NAME and PHONE columns. Each number will be dialed exactly once." />
              <div className="hero-row">
                <div>
                  <div className="eyebrow"><Upload size={12} /> LEAD MANAGEMENT</div>
                  <h2>Upload Leads</h2>
                  <p>Upload a CSV file with NAME and PHONE columns. Each number will be dialed exactly once.</p>
                </div>
              </div>

              {leadPool && (() => {
                const fresh = leadPool.fresh ?? leadPool.new ?? 0;
                const called = leadPool.called ?? 0;
                const suppressed = leadPool.suppressed ?? 0;
                const invalid = leadPool.invalid ?? 0;
                const excludedOther = leadPool.excluded_other ?? 0;
                const dataQuality = leadPool.data_quality ?? 0;
                const bucketSum = fresh + called + suppressed + invalid + excludedOther + dataQuality;
                const reconciled = bucketSum === leadPool.total;
                return (
                <div className="lead-pool-breakdown">
                  <div className="lead-pool-total-row">
                    <div className="stat-card lead-pool-total">
                      <FileUp className="stat-icon" size={20} />
                      <span className="stat-label">TOTAL LEADS</span>
                      <span className="stat-value">{leadPool.total}</span>
                    </div>
                    <div className={`lead-pool-reconciliation-badge ${reconciled ? 'reconciled' : 'mismatch'}`}>
                      {reconciled ? `Buckets sum to ${leadPool.total}` : `Buckets sum to ${bucketSum} \u2260 ${leadPool.total}`}
                    </div>
                  </div>
                  <div className="lead-pool-buckets">
                    <div className="lead-bucket fresh">
                      <span className="bucket-label">FRESH</span>
                      <span className="bucket-value">{fresh}</span>
                      <span className="bucket-hint">Not yet dialed</span>
                    </div>
                    <div className="lead-bucket called">
                      <span className="bucket-label">CALLED</span>
                      <span className="bucket-value">{called}</span>
                      <span className="bucket-hint">Dialed, no suppression</span>
                    </div>
                    <div className="lead-bucket invalid">
                      <span className="bucket-label">INVALID</span>
                      <span className="bucket-value">{invalid}</span>
                      <span className="bucket-hint">Wrong number</span>
                    </div>
                    <div className="lead-bucket excluded">
                      <span className="bucket-label">EXCLUDED / OTHER</span>
                      <span className="bucket-value">{excludedOther}</span>
                      <span className="bucket-hint">Closed, agent-assigned, no call</span>
                    </div>
                    <div className="lead-bucket unclassified">
                      <span className="bucket-label">DATA QUALITY</span>
                      <span className="bucket-value">{dataQuality}</span>
                      <span className="bucket-hint">Closed, no call record, unassigned</span>
                    </div>
                  </div>
                </div>
                );
              })()}

              <div className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow"><FileUp size={12} /> CSV UPLOAD</div>
                    <h3>Drop your lead list</h3>
                  </div>
                  <button className="primary-button" onClick={async () => {
                    try {
                      const tk = localStorage.getItem('sterling_session_token');
                      if (!tk) { alert('You must be logged in'); return; }
                      const ak = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '';
                      const res = await fetch(`${SUPABASE_URL}/functions/v1/wolf-export-humans?token=${encodeURIComponent(tk)}`, {
                        headers: { Authorization: `Bearer ${ak}`, apikey: ak },
                      });
                      if (!res.ok) throw new Error('Download failed');
                      const blob = await res.blob();
                      const u = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = u; a.download = 'human-contacts-all-time.csv'; a.click();
                      URL.revokeObjectURL(u);
                    } catch { alert('Download failed — try again'); }
                  }}>
                    <Download size={14} /> Download Live Humans CSV
                  </button>
                </div>
                <div className="upload-zone"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
                  onDrop={(e) => {
                    e.preventDefault(); e.currentTarget.classList.remove('drag-over');
                    const file = e.dataTransfer.files[0];
                    if (file) handleUploadLeads(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}>
                  <Upload size={36} />
                  <strong>Drop CSV here or click to browse</strong>
                  <span>Columns: NAME, PHONE, ADDRESS, INCOME RANGE, HOME VALUE</span>
                  <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadLeads(f); }} />
                </div>
                {importing && <div className="upload-progress">Importing leads...</div>}
              </div>
            </>
          )}
{isOwner && activeNav === 'calls' && (
            <CallLogView expandedCall={expandedCall} setExpandedCall={setExpandedCall}
              sessionToken={sessionToken} onUnauthorized={atomicLogout} />
          )}
{isOwner && activeNav === 'saved' && (
            <AdminSavedTransfersView
              savedTransfers={allSavedTransfers}
              loading={loadingAllSaved}
              onLoad={() => loadAllSavedTransfers(sessionToken)}
              expandedCall={expandedCall}
              setExpandedCall={setExpandedCall}
              error={allSavedTransfersError}
            />
          )}
</>);
}
