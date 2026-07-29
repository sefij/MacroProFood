import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

interface Props {
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
    label: string
}

const HEIGHT = 84
const WIDTH = 10
const HANDLE_HEIGHT = 10

function roundToStep (value: number, min: number, max: number, step: number): number {
    const snapped = Math.round((value - min) / step) * step + min
    return Math.max(min, Math.min(max, snapped))
}

/**
 * A vertical fader (mixing-console channel-strip style) — drag, click, or
 * arrow keys to set `value`. Same range/step contract as Dial (its circular
 * predecessor, no longer used); built the same way, from scratch, since
 * there's no native HTML element for this either.
 */
export function Fader ({ value, min, max, step, onChange, label }: Props) {
    const trackRef = useRef<HTMLDivElement>(null)

    const setFromClientY = (clientY: number) => {
        const rect = trackRef.current?.getBoundingClientRect()
        if (!rect) return
        const fraction = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
        const raw = min + fraction * (max - min)
        onChange(roundToStep(raw, min, max, step))
    }

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setFromClientY(e.clientY)
    }
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        if (e.buttons !== 1) return
        setFromClientY(e.clientY)
    }

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault()
            onChange(Math.min(max, value + step))
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault()
            onChange(Math.max(min, value - step))
        } else if (e.key === 'Home') {
            e.preventDefault()
            onChange(min)
        } else if (e.key === 'End') {
            e.preventDefault()
            onChange(max)
        }
    }

    const fraction = (value - min) / (max - min)
    const fillHeight = fraction * HEIGHT
    const hundredMarkHeight = ((100 - min) / (max - min)) * HEIGHT

    return (
        <div
            ref={trackRef}
            className="fader-track"
            style={{ height: HEIGHT, width: WIDTH }}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={`${value}%`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
        >
            <div className="fader-mark" style={{ bottom: hundredMarkHeight }} />
            <div className="fader-fill" style={{ height: fillHeight }} />
            <div className="fader-handle" style={{ bottom: fillHeight - HANDLE_HEIGHT / 2 }} />
        </div>
    )
}
