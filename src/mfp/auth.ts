import * as path from 'path'

export interface ResolvedAuth {
    userDataDir: string
    email?: string
    password?: string
}

export function resolveAuth (): ResolvedAuth {
    const email = process.env.MFP_EMAIL || undefined
    const password = process.env.MFP_PASSWORD || undefined
    const userDataDir = path.resolve(process.cwd(), 'mfp-chrome-profile')
    return { userDataDir, email, password }
}
