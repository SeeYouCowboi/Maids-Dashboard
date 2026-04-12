import { useEffect, useRef } from 'react'

export default function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let dots: Dot[] = []
    const spacing = 24
    const mouse = { x: -1000, y: -1000, radius: 250 }

    class Dot {
      x: number
      y: number
      baseX: number
      baseY: number
      vx: number
      vy: number
      size: number
      randomOffset: number

      constructor(x: number, y: number) {
        this.x = x
        this.y = y
        this.baseX = x
        this.baseY = y
        this.vx = 0
        this.vy = 0
        this.size = 1.5
        this.randomOffset = Math.random() * Math.PI * 2
      }

      update(time: number) {
        const waveX = Math.sin(time * 0.001 + this.baseY * 0.01 + this.randomOffset) * 3
        const waveY = Math.cos(time * 0.001 + this.baseX * 0.01 + this.randomOffset) * 3

        const targetX = this.baseX + waveX
        const targetY = this.baseY + waveY

        const dx = mouse.x - this.x
        const dy = mouse.y - this.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < mouse.radius) {
          const forceDirectionX = dx / distance
          const forceDirectionY = dy / distance
          const force = Math.pow((mouse.radius - distance) / mouse.radius, 2)

          this.vx -= forceDirectionX * force * 1.2
          this.vy -= forceDirectionY * force * 1.2
        }

        const spring = 0.015
        this.vx += (targetX - this.x) * spring
        this.vy += (targetY - this.y) * spring

        const friction = 0.92
        this.vx *= friction
        this.vy *= friction

        this.x += this.vx
        this.y += this.vy
      }

      draw() {
        if (!ctx) return
        const distFromBase = Math.sqrt((this.x - this.baseX) ** 2 + (this.y - this.baseY) ** 2)
        const opacity = Math.max(0.2, 1 - distFromBase / 60)

        ctx.fillStyle = `rgba(254, 205, 211, ${String(opacity)})`
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fill()
      }
    }

    const init = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      dots = []

      for (let y = 0; y < canvas.height; y += spacing) {
        for (let x = 0; x < canvas.width; x += spacing) {
          dots.push(new Dot(x, y))
        }
      }
    }

    const animate = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const dot of dots) {
        dot.update(time)
        dot.draw()
      }
      animationFrameId = requestAnimationFrame(animate)
    }

    init()
    animationFrameId = requestAnimationFrame(animate)

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }

    const handleMouseLeave = () => {
      mouse.x = -1000
      mouse.y = -1000
    }

    const handleResize = () => {
      init()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseleave', handleMouseLeave)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />
}
