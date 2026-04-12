import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy } from 'react'
import {
  Home,
  ChefHat,
  BookOpen,
  GraduationCap,
  BarChart3,
  Shield,
  Flower2,
  Music,
  Heart,
} from 'lucide-react'

export interface RoomDefinition {
  id: string
  path: string
  label: string
  icon: ComponentType<{ className?: string | undefined }>
  component: LazyExoticComponent<ComponentType>
  color: string
  bg: string
  dotColor: string
}

const WelcomePage = lazy(() => import('./pages/WelcomePage'))
const GrandHallPage = lazy(() => import('./pages/GrandHallPage'))
const KitchenPage = lazy(() => import('./pages/KitchenPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const ObservatoryPage = lazy(() => import('./pages/ObservatoryPage'))
const WarRoomPage = lazy(() => import('./pages/WarRoomPage'))
const GardenPage = lazy(() => import('./pages/GardenPage'))
const BallroomPage = lazy(() => import('./pages/BallroomPage'))

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 'welcome',
    path: '/',
    label: 'Welcome',
    icon: Heart,
    component: WelcomePage,
    color: 'text-pink-500',
    bg: 'bg-pink-100',
    dotColor: 'bg-pink-500',
  },
  {
    id: 'grand-hall',
    path: '/grand-hall',
    label: 'Grand Hall',
    icon: Home,
    component: GrandHallPage,
    color: 'text-pink-500',
    bg: 'bg-pink-100',
    dotColor: 'bg-pink-500',
  },
  {
    id: 'kitchen',
    path: '/kitchen',
    label: 'Kitchen',
    icon: ChefHat,
    component: KitchenPage,
    color: 'text-blue-500',
    bg: 'bg-blue-100',
    dotColor: 'bg-blue-500',
  },
  {
    id: 'library',
    path: '/library',
    label: 'Library',
    icon: BookOpen,
    component: LibraryPage,
    color: 'text-purple-500',
    bg: 'bg-purple-100',
    dotColor: 'bg-purple-500',
  },
  {
    id: 'study',
    path: '/study',
    label: 'Study',
    icon: GraduationCap,
    component: StudyPage,
    color: 'text-indigo-500',
    bg: 'bg-indigo-100',
    dotColor: 'bg-indigo-500',
  },
  {
    id: 'observatory',
    path: '/observatory',
    label: 'Observatory',
    icon: BarChart3,
    component: ObservatoryPage,
    color: 'text-emerald-500',
    bg: 'bg-emerald-100',
    dotColor: 'bg-emerald-500',
  },
  {
    id: 'war-room',
    path: '/war-room',
    label: 'War Room',
    icon: Shield,
    component: WarRoomPage,
    color: 'text-red-500',
    bg: 'bg-red-100',
    dotColor: 'bg-red-500',
  },
  {
    id: 'garden',
    path: '/garden',
    label: 'Garden',
    icon: Flower2,
    component: GardenPage,
    color: 'text-green-500',
    bg: 'bg-green-100',
    dotColor: 'bg-green-500',
  },
  {
    id: 'ballroom',
    path: '/ballroom',
    label: 'Ballroom',
    icon: Music,
    component: BallroomPage,
    color: 'text-amber-500',
    bg: 'bg-amber-100',
    dotColor: 'bg-amber-500',
  },
] as const

export const NAV_ROOMS = ROOMS.filter((r) => r.id !== 'welcome')

export function getRoomById(id: string): RoomDefinition | undefined {
  return ROOMS.find((r) => r.id === id)
}
