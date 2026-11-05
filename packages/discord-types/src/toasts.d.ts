import type { ComponentType } from "react";
import { ToastPosition as ToastPositionEnum } from "../enums";

export type ToastType = "message" | "success" | "failure" | "custom" | "clip" | "link" | "forward" | "bookmark" | "clock";

export type ToastVariant = "default" | "success" | "critical";
export type ToastPosition = "top" | "bottom";

export type NewToastVariant = ToastVariant;
export type NewToastPosition = ToastPosition;

export interface ToastOptions {
    position?: ToastPositionEnum | ToastPosition;
    duration?: number;
}

/* Can be created via createToast */
export interface ToastData {
    text: string;
    variant?: ToastVariant;
    position?: ToastPosition;
    duration?: number;

    icon?: ComponentType<any>;
    iconColor?: any;
    [key: string]: any;
}

export type showToast = (data: ToastData) => void;
export type popToast = (context?: string) => void;
export type createToast = (message: string, type?: ToastType, options?: ToastOptions) => ToastData;

export interface Toasts {
    show: (data: ToastData | any) => void;
    pop: popToast;
}
