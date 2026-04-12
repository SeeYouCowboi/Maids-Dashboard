import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	BarChart3,
	Cpu,
	HeartPulse,
	Radio,
	Users,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { getHealthz } from "../api/health";
import { listJobs } from "../api/jobs";
import { getRuntimeSnapshot } from "../api/runtime";
import { listSessions } from "../api/sessions";
import { EmptyState } from "../components/ui/EmptyState";
import { GlassCard } from "../components/ui/GlassCard";
import { LoadingSpinner } from "../components/ui/LoadingSpinner";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";
import type {
	HealthzResponse,
	JobListResponse,
	RuntimeSnapshot,
	SessionListResponse,
} from "../contracts";
import { useOffline } from "../hooks/OfflineContext";
import {
	buildWeeklyTimeline,
	computeHealthSummary,
	groupSessionsByDay,
} from "../lib/observatory-aggregations";
import { queryKeys } from "../query/keys";

const POLL_INTERVAL = 30_000;

export default function ObservatoryPage() {
	const { isOffline } = useOffline();

	const healthQuery = useQuery<HealthzResponse, Error>({
		queryKey: queryKeys.health.healthz,
		queryFn: getHealthz,
		refetchInterval: POLL_INTERVAL,
		retry: 0,
	});

	const sessionsQuery = useQuery<SessionListResponse, Error>({
		queryKey: queryKeys.sessions.list(),
		queryFn: listSessions,
		refetchInterval: POLL_INTERVAL,
	});

	const jobsQuery = useQuery<JobListResponse, Error>({
		queryKey: queryKeys.jobs.list(),
		queryFn: listJobs,
		refetchInterval: POLL_INTERVAL,
	});

	const runtimeQuery = useQuery<RuntimeSnapshot, Error>({
		queryKey: queryKeys.runtime.snapshot(),
		queryFn: getRuntimeSnapshot,
		refetchInterval: POLL_INTERVAL,
	});

	const sessions = sessionsQuery.data?.items;
	const summary = useMemo(
		() => computeHealthSummary(sessions, jobsQuery.data, healthQuery.data),
		[sessions, jobsQuery.data, healthQuery.data],
	);

	const weeklyData = useMemo(() => {
		const grouped = groupSessionsByDay(sessions ?? []);
		return buildWeeklyTimeline(grouped);
	}, [sessions]);

	const isLoading =
		healthQuery.isLoading &&
		sessionsQuery.isLoading &&
		jobsQuery.isLoading &&
		runtimeQuery.isLoading;

	if (isLoading) {
		return (
			<div className="space-y-6">
				<PageHeader
					title="Observatory"
					subtitle="System health, activity overview, weekly trends"
				/>
				<div className="py-24">
					<LoadingSpinner />
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<PageHeader
				title="Observatory"
				subtitle="System health, activity overview, weekly trends"
			>
				{isOffline && (
					<StatusBadge status="Offline — cached data" variant="warning" />
				)}
			</PageHeader>

			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatTile
					label="Gateway"
					value={summary.gatewayStatus === "ok" ? "Online" : "Offline"}
					icon={<HeartPulse className="w-5 h-5" />}
					variant={summary.gatewayStatus === "ok" ? "success" : "error"}
					index={0}
				/>
				<StatTile
					label="Active Sessions"
					value={String(summary.activeSessionCount)}
					icon={<Users className="w-5 h-5" />}
					variant="info"
					index={1}
				/>
				<StatTile
					label="Recent Jobs"
					value={String(summary.recentJobCount)}
					icon={<Activity className="w-5 h-5" />}
					variant="info"
					index={2}
				/>
				<StatTile
					label="Provider"
					value={runtimeQuery.data?.backend_type ?? "—"}
					icon={<Cpu className="w-5 h-5" />}
					variant="neutral"
					index={3}
				/>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
				<GlassCard title="Activity Timeline" color="purple">
					{weeklyData.every((p) => p.count === 0) ? (
						<EmptyState
							icon={<Radio className="w-8 h-8" />}
							message="No session activity in the last 7 days"
						/>
					) : (
						<div className="h-64">
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart
									data={weeklyData}
									margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
								>
									<defs>
										<linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
											<stop offset="0%" stopColor="#a78bfa" stopOpacity={0.4} />
											<stop
												offset="95%"
												stopColor="#a78bfa"
												stopOpacity={0.02}
											/>
										</linearGradient>
									</defs>
									<CartesianGrid
										strokeDasharray="3 3"
										stroke="rgba(0,0,0,0.06)"
									/>
									<XAxis
										dataKey="day"
										tick={{ fontSize: 11, fill: "#8c7b82" }}
										tickFormatter={formatDayLabel}
										axisLine={false}
										tickLine={false}
									/>
									<YAxis
										allowDecimals={false}
										tick={{ fontSize: 11, fill: "#8c7b82" }}
										axisLine={false}
										tickLine={false}
									/>
									<Tooltip content={<ChartTooltip />} />
									<Area
										type="monotone"
										dataKey="count"
										stroke="#8b5cf6"
										strokeWidth={2.5}
										fill="url(#areaFill)"
									/>
								</AreaChart>
							</ResponsiveContainer>
						</div>
					)}
				</GlassCard>

				<GlassCard title="Weekly Snapshot" color="emerald">
					{weeklyData.every((p) => p.count === 0) ? (
						<EmptyState
							icon={<BarChart3 className="w-8 h-8" />}
							message="No data for weekly snapshot"
						/>
					) : (
						<div className="h-64">
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={weeklyData}
									margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
								>
									<CartesianGrid
										strokeDasharray="3 3"
										stroke="rgba(0,0,0,0.06)"
									/>
									<XAxis
										dataKey="day"
										tick={{ fontSize: 11, fill: "#8c7b82" }}
										tickFormatter={formatDayLabel}
										axisLine={false}
										tickLine={false}
									/>
									<YAxis
										allowDecimals={false}
										tick={{ fontSize: 11, fill: "#8c7b82" }}
										axisLine={false}
										tickLine={false}
									/>
									<Tooltip content={<ChartTooltip />} />
									<Bar
										dataKey="count"
										fill="#8b5cf6"
										radius={[6, 6, 0, 0]}
										maxBarSize={40}
									/>
								</BarChart>
							</ResponsiveContainer>
						</div>
					)}
				</GlassCard>
			</div>

			<GlassCard color="purple">
				<div className="flex items-start gap-3 text-sm">
					<div className="shrink-0 mt-0.5 p-1.5 rounded-lg bg-purple-100 text-purple-500">
						<BarChart3 className="w-4 h-4" />
					</div>
					<p className="text-gray-500 font-medium leading-relaxed">
						<span className="font-bold text-purple-600">
							v2 Metrics Pipeline
						</span>
						{" — "}
						Detailed metrics pipeline coming in v2. Current data is aggregated
						from live gateway endpoints and may not reflect historical trends
						beyond the active session window.
					</p>
				</div>
			</GlassCard>
		</div>
	);
}

type StatTileProps = {
	label: string;
	value: string;
	icon: React.ReactNode;
	variant: "success" | "error" | "info" | "neutral";
	index: number;
};

const variantStyles = {
	success: {
		bg: "bg-emerald-100",
		text: "text-emerald-600",
		ring: "ring-emerald-200",
	},
	error: { bg: "bg-red-100", text: "text-red-600", ring: "ring-red-200" },
	info: { bg: "bg-blue-100", text: "text-blue-600", ring: "ring-blue-200" },
	neutral: { bg: "bg-gray-100", text: "text-gray-500", ring: "ring-gray-200" },
} as const;

function StatTile({ label, value, icon, variant, index }: StatTileProps) {
	const style = variantStyles[variant];
	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{
				type: "spring",
				bounce: 0.3,
				duration: 0.6,
				delay: index * 0.06,
			}}
			className="bg-white/40 backdrop-blur-xl border border-white/60 shadow-sm rounded-2xl p-5 hover:shadow-md transition-all duration-300"
		>
			<div className="flex items-center gap-3 mb-3">
				<div
					className={`p-2 rounded-xl ${style.bg} ${style.text} ring-1 ${style.ring}`}
				>
					{icon}
				</div>
				<span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
					{label}
				</span>
			</div>
			<p className={`text-2xl font-black ${style.text}`}>{value}</p>
		</motion.div>
	);
}

function formatDayLabel(day: string): string {
	const parts = day.split("-");
	const month = parts[1];
	const d = parts[2];
	if (!month || !d) return day;
	return `${month}/${d}`;
}

function ChartTooltip({
	active,
	payload,
	label,
}: {
	active?: boolean | undefined;
	payload?: readonly { value?: number | undefined }[] | undefined;
	label?: string | undefined;
}) {
	if (!active || !payload || payload.length === 0) return null;
	const first = payload[0];
	return (
		<div className="bg-gray-900/90 backdrop-blur-sm text-white text-xs font-semibold rounded-lg px-3 py-2 shadow-lg border border-white/10">
			<p className="text-gray-300 mb-0.5">{label}</p>
			<p>
				{first?.value ?? 0} session{(first?.value ?? 0) === 1 ? "" : "s"}
			</p>
		</div>
	);
}
