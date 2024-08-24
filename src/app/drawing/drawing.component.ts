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
  private lineStartPoint: { x: number; y: number } | null = null;
  private linePreview: { start: { x: number; y: number }, end: { x: number; y: number } } | null = null;
  backgroundType: 'none' | 'grid' | 'lined' = 'none';
  private isLineDrawingMode = false;
  private readonly HORIZONTAL_SNAP_THRESHOLD = 5; // in degrees
  private readonly VERTICAL_SNAP_THRESHOLD = 2; // in degrees
  private readonly HORIZONTAL_SNAP_DISTANCE_THRESHOLD = 0.02; // 2% of the canvas height
  private readonly VERTICAL_SNAP_DISTANCE_THRESHOLD = 0.02; // 2% of the canvas width
  
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
    if (this.isShiftPressed || this.isLineDrawingMode) {
      const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
      this.lineStartPoint = { x, y };
      this.isLineDrawingMode = true;
    } else {
      this.startDrawing(event.clientX, event.clientY);
    }
  }

  onMouseMove(event: MouseEvent) {
    if (this.isDrawing) {
      this.capturePoint(event.clientX, event.clientY);
      this.redrawCanvas();
    } else if (this.isLineDrawingMode && this.lineStartPoint) {
      const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
      const snappedEnd = this.getSnappedEndPoint(this.lineStartPoint, { x, y });
      this.linePreview = {
        start: this.lineStartPoint,
        end: snappedEnd
      };
      this.redrawCanvas();
    }
    
    if (this.isEraser) {
      this.drawEraserPreview(event.clientX, event.clientY);
    }
  }
  
  onMouseUp(event: MouseEvent) {
    if (this.isLineDrawingMode && this.lineStartPoint) {
      const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
      const snappedEnd = this.getSnappedEndPoint(this.lineStartPoint, { x, y });
      this.actions.push({
        path: [this.lineStartPoint, snappedEnd],
        color: this.currentColor,
        lineWidth: this.brushSize,
        isEraser: false
      });
      this.lineStartPoint = null;
      this.linePreview = null;
      this.isLineDrawingMode = false;
    } else {
      this.stopDrawing();
    }
    this.redrawCanvas();
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
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      this.isShiftPressed = true;
    }
    if (event.ctrlKey && event.key === 'z') {
      this.undo();
    } else if (event.ctrlKey && event.key === 'y') {
      this.redo();
    }
  }
  
  @HostListener('document:keyup', ['$event'])
  handleKeyUp(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      this.isShiftPressed = false;
      if (!this.isLineDrawingMode) {
        this.lineStartPoint = null;
        this.linePreview = null;
        this.redrawCanvas();
      }
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
      this.redrawCanvas();
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
    this.redrawCanvas();
  }

  private redrawCanvas() {
    if (!this.ctx || !this.canvasRef) {
      return;
    }
  
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
  
    // Draw background
    if (this.backgroundType === 'grid') {
      this.drawGrid();
    } else if (this.backgroundType === 'lined') {
      this.drawLined();
    } else {
      this.ctx.fillStyle = this.backgroundColor;
      this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  
    // Create a temporary canvas for drawing actions
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;
  
    // Draw all actions on the temporary canvas
    for (const action of this.actions) {
      this.drawPath(tempCtx, action.path, action.color, action.lineWidth, action.isEraser);
    }
  
    // Draw the current path if we're drawing
    if (this.isDrawing) {
      const smoothCurrentPath = this.createSmoothPath(this.currentPath);
      this.drawPath(tempCtx, smoothCurrentPath, this.isEraser ? this.backgroundColor : this.currentColor, this.brushSize, this.isEraser);
    }
  
    // Draw the temporary canvas onto the main canvas
    this.ctx.drawImage(tempCanvas, 0, 0);
  
    // Draw the line preview if applicable
    if (this.linePreview) {
      this.drawLine(this.ctx, this.linePreview.start, this.linePreview.end, this.currentColor, this.brushSize);
    }
  }

  private getCanvasCoordinates(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  }

  private drawGrid() {
    const canvas = this.canvasRef.nativeElement;
    const gridSize = 20;
    this.ctx.strokeStyle = '#9cb7f7';
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
    const lineSpacing = 20;
    this.ctx.strokeStyle = '#9cb7f7';
    this.ctx.lineWidth = 0.5;
  
    for (let y = 0; y <= canvas.height; y += lineSpacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(canvas.width, y);
      this.ctx.stroke();
    }
  }

  private drawPath(ctx: CanvasRenderingContext2D, path: { x: number; y: number }[], color: string, lineWidth: number, isEraser: boolean) {
    if (path.length < 2) return;
  
    const canvas = this.canvasRef.nativeElement;
    ctx.beginPath();
    ctx.moveTo(path[0].x * canvas.width, path[0].y * canvas.height);
  
    for (let i = 1; i < path.length; i++) {
      const xc = (path[i].x + path[i - 1].x) / 2 * canvas.width;
      const yc = (path[i].y + path[i - 1].y) / 2 * canvas.height;
      ctx.quadraticCurveTo(path[i - 1].x * canvas.width, path[i - 1].y * canvas.height, xc, yc);
    }
  
    const last = path[path.length - 1];
    ctx.lineTo(last.x * canvas.width, last.y * canvas.height);
  
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  
    if (isEraser) {
      ctx.globalCompositeOperation = 'destination-out';
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  private createSmoothPath(points: { x: number; y: number }[]): { x: number; y: number }[] {
    if (points.length < 3) {
      return points;
    }
  
    const smoothPath: { x: number; y: number }[] = [];
    smoothPath.push(points[0]);
  
    for (let i = 1; i < points.length - 1; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
  
      const ctrl1 = {
        x: p0.x + (p1.x - p0.x) / 2,
        y: p0.y + (p1.y - p0.y) / 2
      };
      const ctrl2 = {
        x: p1.x + (p2.x - p1.x) / 2,
        y: p1.y + (p2.y - p1.y) / 2
      };
  
      for (let t = 0; t <= 1; t += 0.1) {
        const x = Math.pow(1 - t, 2) * ctrl1.x + 2 * (1 - t) * t * p1.x + Math.pow(t, 2) * ctrl2.x;
        const y = Math.pow(1 - t, 2) * ctrl1.y + 2 * (1 - t) * t * p1.y + Math.pow(t, 2) * ctrl2.y;
        smoothPath.push({ x, y });
      }
    }
  
    smoothPath.push(points[points.length - 1]);
  
    return smoothPath;
  }

  private drawEraserPreview(clientX: number, clientY: number) {
    if (!this.ctx || !this.canvasRef) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = (clientX - rect.left);
    const y = (clientY - rect.top);
    const size = this.brushSize;

    this.redrawCanvas(); 

    this.ctx.strokeStyle = 'black';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x - size / 2, y - size / 2, size, size); 
  }

  private drawLine(ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }, color: string, lineWidth: number) {
    const canvas = this.canvasRef.nativeElement;
    ctx.beginPath();
    ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
    ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private getSnappedEndPoint(start: { x: number; y: number }, end: { x: number; y: number }): { x: number; y: number } {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  
    if (angle < this.HORIZONTAL_SNAP_THRESHOLD || Math.abs(angle - 180) < this.HORIZONTAL_SNAP_THRESHOLD) {
      if (Math.abs(dy) < this.HORIZONTAL_SNAP_DISTANCE_THRESHOLD) {
        return { x: end.x, y: start.y };
      }
    }
    
    if (Math.abs(angle - 90) < this.VERTICAL_SNAP_THRESHOLD || Math.abs(angle - 270) < this.VERTICAL_SNAP_THRESHOLD) {
      if (Math.abs(dx) < this.VERTICAL_SNAP_DISTANCE_THRESHOLD) {
        return { x: start.x, y: end.y };
      }
    }
  
    return end;
  }
}