import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Check, MapPin, Navigation, Pencil, Plus, Route, Sparkles, X } from 'lucide-react'
import { post, put, remove } from '../services/api.js'

export default function RoutesAndStops({ routes, showNotice, onRefresh }) {
  const [selectedId, setSelectedId] = useState('')
  const [routeForm, setRouteForm] = useState({ routeId: '', routeName: '', origin: '', destination: '' })
  const [stopForm, setStopForm] = useState({ stopId: '', stopName: '', latitude: '', longitude: '', sequence: 1 })
  const [routeDraft, setRouteDraft] = useState(null)
  const [editingStop, setEditingStop] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const route = routes.find((item) => item._id === selectedId)
  const orderedStops = [...(route?.stops || [])].filter((stop) => stop.isActive !== false).sort((a, b) => a.sequence - b.sequence)

  useEffect(() => { if (!selectedId && routes.length) setSelectedId(routes[0]._id) }, [routes, selectedId])
  useEffect(() => {
    if (route) setRouteDraft({ routeName: route.routeName, origin: route.origin, destination: route.destination, polyline: route.polyline || '' })
    else setRouteDraft(null)
    setEditingStop(null)
  }, [selectedId, routes.length])

  const createRoute = async (event) => {
    event.preventDefault(); setError('')
    try {
      const created = await post('/routes', routeForm)
      setRouteForm({ routeId: '', routeName: '', origin: '', destination: '' })
      setSelectedId(created._id); showNotice('Route created. Add its stops below.'); await onRefresh()
    } catch (reason) { setError(reason.message) }
  }
  const saveRoute = async (event) => {
    event.preventDefault(); if (!route) return; setError('')
    try { await put(`/routes/${encodeURIComponent(route.routeId)}`, routeDraft); showNotice('Route details updated.'); await onRefresh() }
    catch (reason) { setError(reason.message) }
  }
  const generatePolyline = async () => {
    if (!route || orderedStops.length < 2) return
    setError(''); setGenerating(true)
    try {
      await post(`/routes/${encodeURIComponent(route.routeId)}/generate-polyline`)
      showNotice('Road-following route geometry generated and saved.')
      await onRefresh()
    } catch (reason) { setError(reason.message) }
    finally { setGenerating(false) }
  }
  const deactivateRoute = async () => {
    if (!route || !window.confirm(`Deactivate ${route.routeName}?`)) return
    try { await remove(`/routes/${encodeURIComponent(route.routeId)}`); showNotice('Route deactivated.'); await onRefresh() }
    catch (reason) { showNotice(reason.message) }
  }
  const createStop = async (event) => {
    event.preventDefault(); if (!route) return; setError('')
    try {
      await post(`/routes/${encodeURIComponent(route.routeId)}/stops`, { ...stopForm, sequence: Number(stopForm.sequence) })
      setStopForm({ stopId: '', stopName: '', latitude: '', longitude: '', sequence: orderedStops.length + 2 })
      showNotice('Stop added to the route.'); await onRefresh()
    } catch (reason) { setError(reason.message) }
  }
  const saveStop = async (event) => {
    event.preventDefault(); if (!editingStop) return; setError('')
    try { await put(`/stops/${encodeURIComponent(editingStop.stopId)}`, { stopName: editingStop.stopName, latitude: Number(editingStop.latitude), longitude: Number(editingStop.longitude) }); setEditingStop(null); showNotice('Stop details updated.'); await onRefresh() }
    catch (reason) { setError(reason.message) }
  }
  const deleteStop = async (stop) => {
    try { await remove(`/stops/${encodeURIComponent(stop.stopId)}`); showNotice('Stop removed.'); await onRefresh() }
    catch (reason) { showNotice(reason.message) }
  }
  const reorderStop = async (index, direction) => {
    const next = [...orderedStops]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    try { await post(`/routes/${encodeURIComponent(route.routeId)}/stops/reorder`, { stopIds: next.map((stop) => stop.stopId) }); showNotice('Stop order updated.'); await onRefresh() }
    catch (reason) { showNotice(reason.message) }
  }

  return <div className="route-admin-grid">
    <section className="admin-card route-editor-card">
      <div className="admin-card-heading"><div><span className="panel-label">ROUTE BUILDER</span><h2>Routes & stops</h2></div><Route size={18} className="muted-icon" /></div>
      <label className="select-label">Select a route<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose a route</option>{routes.map((item) => <option key={item._id} value={item._id}>{item.routeName}{item.isActive ? '' : ' (inactive)'}</option>)}</select></label>
      {route ? <>
        <div className="route-preview"><span className="route-preview-icon"><Navigation size={16} /></span><span><b>{route.routeName}</b><small>{route.origin} <ArrowRight size={10} /> {route.destination}</small></span><span className="route-preview-stops">{orderedStops.length} stops</span></div>
        <button type="button" className="button-primary compact-button" disabled={generating || orderedStops.length < 2} onClick={generatePolyline}><Sparkles size={14} /> {generating ? 'Generating route…' : 'Generate road route'}</button>
        <form className="route-details-form" onSubmit={saveRoute}><div className="route-details-heading"><span className="form-subheading"><Pencil size={13} /> Route details</span><button type="button" className="text-button danger-text" onClick={deactivateRoute}>Deactivate route</button></div><div className="form-grid compact"><label>Route name<input required value={routeDraft?.routeName || ''} onChange={(event) => setRouteDraft({ ...routeDraft, routeName: event.target.value })} /></label><label>Starting point<input required value={routeDraft?.origin || ''} onChange={(event) => setRouteDraft({ ...routeDraft, origin: event.target.value })} /></label><label className="full-field">Destination<input required value={routeDraft?.destination || ''} onChange={(event) => setRouteDraft({ ...routeDraft, destination: event.target.value })} /></label></div><button className="button-outline compact-button"><Check size={13} /> Save route</button></form>
        <div className="stop-admin-list">{orderedStops.map((stop, index) => <div className="stop-admin-group" key={stop._id}><div className="stop-admin-row"><span className="stop-sequence">{String(index + 1).padStart(2, '0')}</span><span><b>{stop.stopName}</b><small>{Number(stop.latitude).toFixed(4)}, {Number(stop.longitude).toFixed(4)}</small></span><button className="icon-button reorder-button" title="Move stop up" disabled={index === 0} onClick={() => reorderStop(index, -1)}><ArrowUp size={13} /></button><button className="icon-button reorder-button" title="Move stop down" disabled={index === orderedStops.length - 1} onClick={() => reorderStop(index, 1)}><ArrowDown size={13} /></button><button className="icon-button" title="Edit stop" onClick={() => setEditingStop({ stopId: stop.stopId, stopName: stop.stopName, latitude: stop.latitude, longitude: stop.longitude })}><Pencil size={13} /></button><button className="icon-button danger-icon" title="Remove stop" onClick={() => deleteStop(stop)}><X size={14} /></button></div>{editingStop?.stopId === stop.stopId && <form className="stop-edit-form" onSubmit={saveStop}><label>Stop name<input required value={editingStop.stopName} onChange={(event) => setEditingStop({ ...editingStop, stopName: event.target.value })} /></label><label>Latitude<input required type="number" step="any" value={editingStop.latitude} onChange={(event) => setEditingStop({ ...editingStop, latitude: event.target.value })} /></label><label>Longitude<input required type="number" step="any" value={editingStop.longitude} onChange={(event) => setEditingStop({ ...editingStop, longitude: event.target.value })} /></label><button className="text-button" type="button" onClick={() => setEditingStop(null)}>Cancel</button><button className="button-primary compact-button"><Check size={13} /> Save stop</button></form>}</div>)}</div>
        <form className="add-stop-form" onSubmit={createStop}><span className="form-subheading"><Plus size={14} /> Add a stop</span><div className="form-grid compact"><label>Stop ID<input required value={stopForm.stopId} onChange={(event) => setStopForm({ ...stopForm, stopId: event.target.value.toUpperCase() })} placeholder="NORTH-05" /></label><label>Stop name<input required value={stopForm.stopName} onChange={(event) => setStopForm({ ...stopForm, stopName: event.target.value })} placeholder="Library Gate" /></label><label>Latitude<input required type="number" step="any" value={stopForm.latitude} onChange={(event) => setStopForm({ ...stopForm, latitude: event.target.value })} placeholder="17.4050" /></label><label>Longitude<input required type="number" step="any" value={stopForm.longitude} onChange={(event) => setStopForm({ ...stopForm, longitude: event.target.value })} placeholder="78.5570" /></label><label className="full-field">Sequence<input required type="number" min="1" value={stopForm.sequence} onChange={(event) => setStopForm({ ...stopForm, sequence: Number(event.target.value) })} /></label></div><button className="button-primary compact-button"><Plus size={14} /> Add stop</button></form>
      </> : <div className="empty-route"><EmptyRoute />Create a route to start managing campus stops.</div>}
      {error && <div className="inline-error">{error}</div>}
    </section>
    <section className="admin-card new-route-card"><div className="admin-card-heading"><div><span className="panel-label">NEW CONNECTION</span><h2>Create a route</h2></div></div><form className="stack-form" onSubmit={createRoute}><label>Route ID<input required value={routeForm.routeId} onChange={(event) => setRouteForm({ ...routeForm, routeId: event.target.value.toUpperCase() })} placeholder="HYD-SOUTH" /></label><label>Route name<input required value={routeForm.routeName} onChange={(event) => setRouteForm({ ...routeForm, routeName: event.target.value })} placeholder="South Campus Line" /></label><label>Starting point<input required value={routeForm.origin} onChange={(event) => setRouteForm({ ...routeForm, origin: event.target.value })} placeholder="Mehdipatnam" /></label><label>Destination<input required value={routeForm.destination} onChange={(event) => setRouteForm({ ...routeForm, destination: event.target.value })} placeholder="South Campus" /></label><button className="button-primary">Create route <ArrowRight size={15} /></button></form><div className="route-tip"><Sparkles size={16} /><span><b>A good route has a clear order.</b><small>Stops are sequenced in the order the bus will visit them. Coordinates are stored directly, so you can add stops without geocoding.</small></span></div></section>
  </div>
}

function EmptyRoute() { return <span className="empty-route-icon"><MapPin size={18} /></span> }
