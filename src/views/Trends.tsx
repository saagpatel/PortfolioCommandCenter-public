import { useMemo } from "react";
import type { HistoryPoint } from "../types";

interface Series {
	label: string;
	color: string;
	values: (number | null)[]; // null = no data at that x (e.g. pre-security snapshot)
}

const TIER_COLORS = {
	elevated: "#ff5c5c",
	moderate: "#ffb053",
	baseline: "#4cc38a",
	deferred: "#6b7280",
} as const;

const SEC_COLOR = "#5b9dff";

/** Split a series into contiguous non-null segments so gaps aren't bridged. */
function segments(values: (number | null)[]): [number, number][][] {
	const segs: [number, number][][] = [];
	let cur: [number, number][] = [];
	values.forEach((v, i) => {
		if (v == null) {
			if (cur.length) segs.push(cur);
			cur = [];
		} else {
			cur.push([i, v]);
		}
	});
	if (cur.length) segs.push(cur);
	return segs;
}

function LineChart({
	xLabels,
	series,
	height = 220,
}: {
	xLabels: string[];
	series: Series[];
	height?: number;
}) {
	const W = 880;
	const H = height;
	const padL = 36;
	const padR = 12;
	const padT = 12;
	const padB = 26;
	const n = xLabels.length;

	const maxY = Math.max(
		1,
		...series.flatMap((s) =>
			s.values.filter((v): v is number => v != null),
		),
	);

	const x = (i: number) =>
		padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
	const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

	// Horizontal gridlines at 0, 25, 50, 75, 100% of maxY.
	const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));

	return (
		<svg
			viewBox={`0 0 ${W} ${H}`}
			width="100%"
			role="img"
			aria-label="Trend chart"
		>
			{gridVals.map((gv, gi) => (
				// Key by index: rounded gridVals can repeat at small maxY (e.g.
				// maxY=2 → [0,1,1,2,2]), which would collide on value-keys.
				<g key={gi}>
					<line
						x1={padL}
						x2={W - padR}
						y1={y(gv)}
						y2={y(gv)}
						stroke="#2a2f3a"
						strokeWidth={1}
					/>
					<text x={4} y={y(gv) + 4} fill="#9aa3b2" fontSize={10}>
						{gv}
					</text>
				</g>
			))}
			{series.map((s) =>
				segments(s.values).map((seg, si) => (
					<g key={`${s.label}-${si}`}>
						<polyline
							fill="none"
							stroke={s.color}
							strokeWidth={2}
							points={seg.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}
						/>
						{/* Markers make vertices legible and keep a lone point visible
						    (a single-point series has no line to draw). */}
						{seg.map(([i, v]) => (
							<circle
								key={`${i}`}
								cx={x(i)}
								cy={y(v)}
								r={seg.length === 1 ? 3.5 : 1.8}
								fill={s.color}
							/>
						))}
					</g>
				)),
			)}
			{/* First + last x labels only — 70+ ticks would be unreadable. */}
			{n > 0 && (
				<>
					<text x={padL} y={H - 8} fill="#9aa3b2" fontSize={10}>
						{xLabels[0]}
					</text>
					<text
						x={W - padR}
						y={H - 8}
						fill="#9aa3b2"
						fontSize={10}
						textAnchor="end"
					>
						{xLabels[n - 1]}
					</text>
				</>
			)}
		</svg>
	);
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
	return (
		<p className="chart-legend">
			{items.map((it) => (
				<span key={it.label}>
					<span className="swatch" style={{ background: it.color }} />
					{it.label}
				</span>
			))}
		</p>
	);
}

export function Trends({ history }: { history: HistoryPoint[] | null }) {
	const xLabels = useMemo(
		() => (history ?? []).map((h) => h.generated_at.slice(0, 10)),
		[history],
	);

	const riskSeries: Series[] = useMemo(
		() =>
			history
				? [
						{
							label: "elevated",
							color: TIER_COLORS.elevated,
							values: history.map((h) => h.elevated),
						},
						{
							label: "moderate",
							color: TIER_COLORS.moderate,
							values: history.map((h) => h.moderate),
						},
						{
							label: "baseline",
							color: TIER_COLORS.baseline,
							values: history.map((h) => h.baseline),
						},
						{
							label: "deferred",
							color: TIER_COLORS.deferred,
							values: history.map((h) => h.deferred),
						},
					]
				: [],
		[history],
	);

	const secSeries: Series[] = useMemo(
		() =>
			history
				? [
						{
							label: "repos w/ open high+crit",
							color: SEC_COLOR,
							// null before the security overlay existed → drawn as a gap.
							values: history.map((h) =>
								h.has_security ? h.repos_open_high_crit : null,
							),
						},
					]
				: [],
		[history],
	);

	if (history === null) {
		return (
			<div className="panel">
				<h2>Trends</h2>
				<p className="muted">Loading snapshot history…</p>
			</div>
		);
	}

	if (history.length === 0) {
		return (
			<div className="panel">
				<h2>Trends</h2>
				<p className="muted">
					No timestamped <code>portfolio-truth-*.json</code> snapshots found to
					trend.
				</p>
			</div>
		);
	}

	const hasAnySecurity = history.some((h) => h.has_security);

	return (
		<>
			<div className="panel">
				<h2>Risk tiers over time</h2>
				<p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
					{history.length} snapshots · {xLabels[0]} → {xLabels[xLabels.length - 1]}
				</p>
				<Legend
					items={[
						{ label: "elevated", color: TIER_COLORS.elevated },
						{ label: "moderate", color: TIER_COLORS.moderate },
						{ label: "baseline", color: TIER_COLORS.baseline },
						{ label: "deferred", color: TIER_COLORS.deferred },
					]}
				/>
				<LineChart xLabels={xLabels} series={riskSeries} />
			</div>

			<div className="panel">
				<h2>Open high/critical repos over time</h2>
				{hasAnySecurity ? (
					<>
						<Legend
							items={[
								{ label: "repos w/ open high+crit", color: SEC_COLOR },
							]}
						/>
						<LineChart xLabels={xLabels} series={secSeries} height={200} />
					</>
				) : (
					<p className="muted">
						No snapshot in range carries the security overlay yet. Re-run the
						auditor with <code>--portfolio-truth-include-security</code> to start
						the trend.
					</p>
				)}
			</div>
		</>
	);
}
