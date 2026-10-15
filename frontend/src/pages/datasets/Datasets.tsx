import { useState } from 'react';
import { Link } from 'react-router-dom';
import catalog from '../../../../datasets/catalog.json';

export function Datasets() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const datasets = catalog.datasets.filter(dataset =>
    (status === 'All' || dataset.status === status) &&
    `${dataset.name} ${dataset.category} ${dataset.provides.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="dashboard-shell">
    <Link to="/" style={{ color: '#cbe86b' }}>← Back to Dashboard</Link>
    <h1>Project datasets</h1>
    <p className="dataset-intro">Public sources matched to TerraScope. Connected sources can populate measurements; reference sources below still need their own ingestion modules.</p>
    <p className="dataset-intro">Public demo farms use historical benchmark boundaries. Their crop type, planting dates and yield remain unknown unless the source records them. Your original fields are separate.</p>
    <div className="dataset-filters">
      <label>Search datasets<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Weather, soil, boundaries…" /></label>
      <label>Integration status<select value={status} onChange={event => setStatus(event.target.value)}>{['All','Connected','Demo source','Reference only'].map(value => <option key={value}>{value}</option>)}</select></label>
    </div>
    <p role="status">{datasets.length} sources · reviewed {catalog.reviewedOn}</p>
    <section className="dataset-grid" aria-label="Data sources">{datasets.map(dataset => <article key={dataset.id} className="dataset-card">
      <span className="eyebrow">{dataset.category} · {dataset.status}</span><h2>{dataset.name}</h2>
      <p>{dataset.coverage}</p><p><strong>Resolution:</strong> {dataset.resolution}</p>
      <ul>{dataset.provides.map(value => <li key={value}>{value}</li>)}</ul>
      <p className="dataset-limits">{dataset.limits}</p>
      <p><strong>License:</strong> {dataset.license}</p>
      <a href={dataset.url} target="_blank" rel="noreferrer">Official dataset ↗</a>{' · '}
      <a href={dataset.access} target="_blank" rel="noreferrer">Access / download ↗</a>
    </article>)}</section>
    {!datasets.length && <p>No sources match this search. Clear the search or choose All.</p>}
  </main>;
}
