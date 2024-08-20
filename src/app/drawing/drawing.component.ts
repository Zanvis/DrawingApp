import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { debounceTime, fromEvent, Subscription } from 'rxjs';

interface DrawAction {
  path: { x: number; y: number }[];
  color: string;
  lineWidth: number;
  isEraser: boolean;
}

@Component({
  selector: 'app-drawing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './drawing.component.html',
  styleUrl: './drawing.component.css'
})
export class DrawingComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  private ctx!: CanvasRenderingContext2D;
  private isDrawing = false;
  actions: DrawAction[] = [];
  redoActions: DrawAction[] = [];
  private currentPath: { x: number; y: number }[] = [];
  currentColor = '#000000';
  predefinedColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'];
  private resizeSubscription: Subscription | undefined;
  isEraser = false;
  brushSize = 2;
  backgroundColor = '#FFFFFF';
  private isShiftPressed = false;
  backgroundType: 'none' | 'grid' | 'lined' = 'none';

  changeBackground(event: Event) {
    event.preventDefault();
    const selectElement = event.target as HTMLSelectElement;
    const selectedValue = selectElement.value as 'none' | 'grid' | 'lined';
    this.backgroundType = selectedValue;
    this.redrawCanvas();
  }
  
  
  constructor(private ngZone: NgZone) {}

  ngAfterViewInit() {
    this.initializeCanvas();
    this.setupResizeListener();
  }

  ngOnDestroy() {
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }

  private initializeCanvas() {
    if (this.canvasRef && this.canvasRef.nativeElement) {
      const canvas = this.canvasRef.nativeElement;
      this.ctx = canvas.getContext('2d')!;
      this.resizeCanvas();
      this.ctx.fillStyle = this.backgroundColor;
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      console.error('Canvas element not found');
    }
  }

  private setupResizeListener() {
    this.ngZone.runOutsideAngular(() => {
      this.resizeSubscription = fromEvent(window, 'resize')
        .pipe(debounceTime(200))
        .subscribe(() => {
          this.ngZone.run(() => this.resizeCanvas());
        });
    });
  }

  private resizeCanvas() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    this.redrawCanvas();
  }

  selectColor(color: string) {
    this.currentColor = color;
    this.isEraser = false;
  }

  onColorPickerChange() {
    this.isEraser = false;
  }

  toggleEraser() {
    this.isEraser = !this.isEraser;
  }

  onMouseDown(event: MouseEvent) {
    event.preventDefault();
    this.startDrawing(event.clientX, event.clientY);
  }

  onMouseMove(event: MouseEvent) {
    event.preventDefault();
    if (this.isDrawing) {
      this.capturePoint(event.clientX, event.clientY);
      this.redrawCanvas();
    }
  }

  onMouseUp() {
    this.stopDrawing();
  }

  onTouchStart(event: TouchEvent) {
    event.preventDefault();
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.startDrawing(touch.clientX, touch.clientY);
    }
  }

  onTouchMove(event: TouchEvent) {
    event.preventDefault();
    if (this.isDrawing && event.touches.length === 1) {
      const touch = event.touches[0];
      this.capturePoint(touch.clientX, touch.clientY);
      this.redrawCanvas();
    }
  }

  onTouchEnd() {
    this.stopDrawing();
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'z') {
      this.undo();
    } else if (event.ctrlKey && event.key === 'y') {
      this.redo();
    }
  }

  private startDrawing(x: number, y: number) {
    if (!this.ctx) {
      this.initializeCanvas();
    }
    this.isDrawing = true;
    this.currentPath = [];
    this.capturePoint(x, y);
  }

  private stopDrawing() {
    if (this.isDrawing) {
      this.isDrawing = false;
      if (this.currentPath.length > 1) {
        const smoothPath = this.createSmoothPath(this.currentPath);
        this.actions.push({
          path: smoothPath,
          color: this.isEraser ? this.backgroundColor : this.currentColor,
          lineWidth: this.brushSize,
          isEraser: this.isEraser
        });
        this.redoActions = [];
      }
      this.currentPath = [];
    }
  }

  private capturePoint(clientX: number, clientY: number) {
    if (!this.canvasRef) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    this.currentPath.push({ x, y });
  }

  undo() {
    if (this.actions.length > 0) {
      const action = this.actions.pop()!;
      this.redoActions.push(action);
      this.redrawCanvas();
    }
  }

  redo() {
    if (this.redoActions.length > 0) {
      const action = this.redoActions.pop()!;
      this.actions.push(action);
      this.redrawCanvas();
    }
  }

  clearCanvas() {
    this.actions = [];
    this.redoActions = [];
    this.ctx.fillStyle = this.backgroundColor;
    this.ctx.fillRect(0, 0, this.canvasRef.nativeElement.width, this.canvasRef.nativeElement.height);
  }

  private redrawCanvas() {
    if (!this.ctx || !this.canvasRef) {
      return;
    }
  
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas
  
    if (this.backgroundType === 'grid') {
      this.drawGrid();
    } else if (this.backgroundType === 'lined') {
      this.drawLined();
    } else {
      this.ctx.fillStyle = this.backgroundColor;
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  
    for (const action of this.actions) {
      this.drawPath(action.path, action.color, action.lineWidth, action.isEraser);
    }
  
    if (this.isDrawing) {
      const smoothCurrentPath = this.createSmoothPath(this.currentPath);
      this.drawPath(smoothCurrentPath, this.isEraser ? this.backgroundColor : this.currentColor, this.brushSize, this.isEraser);
    }
  }
  
  private drawGrid() {
    const canvas = this.canvasRef.nativeElement;
    const gridSize = 20; // Grid cell size
    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 0.5;
  
    for (let x = 0; x <= canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, canvas.height);
      this.ctx.stroke();
    }
  
    for (let y = 0; y <= canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(canvas.width, y);
      this.ctx.stroke();
    }
  }
  
  private drawLined() {
    const canvas = this.canvasRef.nativeElement;
    const lineSpacing = 20; // Line spacing size
    this.ctx.strokeStyle = '#e0e0e0';
    this.ctx.lineWidth = 0.5;
  
    for (let y = 0; y <= canvas.height; y += lineSpacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(canvas.width, y);
      this.ctx.stroke();
    }
  }

  private drawPath(path: { x: number; y: number }[], color: string, lineWidth: number, isEraser: boolean) {
    if (path.length < 2) return;
  
    const canvas = this.canvasRef.nativeElement;
    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x * canvas.width, path[0].y * canvas.height);
  
    for (let i = 1; i < path.length; i++) {
      const xc = (path[i].x + path[i - 1].x) / 2 * canvas.width;
      const yc = (path[i].y + path[i - 1].y) / 2 * canvas.height;
      this.ctx.quadraticCurveTo(path[i - 1].x * canvas.width, path[i - 1].y * canvas.height, xc, yc);
    }
  
    // For the last point
    const last = path[path.length - 1];
    this.ctx.lineTo(last.x * canvas.width, last.y * canvas.height);
  
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  
    if (isEraser) {
      this.ctx.globalCompositeOperation = 'destination-out';
    }
    this.ctx.stroke();
    this.ctx.globalCompositeOperation = 'source-over';
  }
  private createSmoothPath(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 3) {
      return points;
    }
  
    const smoothPath: { x: number; y: number }[] = [];
    
    // Start with the first point
    smoothPath.push(points[0]);
  
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
  
      // Calculate control points
      const ctrl1 = {
        x: p0.x + (p1.x - p0.x) / 2,
        y: p0.y + (p1.y - p0.y) / 2
      };
      const ctrl2 = {
        x: p1.x + (p2.x - p1.x) / 2,
        y: p1.y + (p2.y - p1.y) / 2
      };
  
      // Add points along the curve
      for (let t = 0; t <= 1; t += 0.1) {
        const x = Math.pow(1 - t, 2) * ctrl1.x + 2 * (1 - t) * t * p1.x + Math.pow(t, 2) * ctrl2.x;
        const y = Math.pow(1 - t, 2) * ctrl1.y + 2 * (1 - t) * t * p1.y + Math.pow(t, 2) * ctrl2.y;
        smoothPath.push({ x, y });
      }
    }
  
    // End with the last point
    smoothPath.push(points[points.length - 1]);
  
    return smoothPath;
  }
}