import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { debounceTime, fromEvent, Subscription } from 'rxjs';

interface DrawAction {
  path: { x: number; y: number }[];
  color: string;
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
    
    // Set the canvas size to match its CSS size
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    this.redrawCanvas();
  }

  selectColor(color: string) {
    this.currentColor = color;
  }

  onColorPickerChange() {
    // This method is called when the color picker value changes
    // You can add any additional logic here if needed
  }

  onMouseDown(event: MouseEvent) {
    if (!this.ctx) {
      this.initializeCanvas();
    }
    this.isDrawing = true;
    this.currentPath = [];
    this.capturePoint(event);
  }

  onMouseMove(event: MouseEvent) {
    if (this.isDrawing) {
      this.capturePoint(event);
      this.redrawCanvas();
    }
  }

  onMouseUp() {
    if (this.isDrawing) {
      this.isDrawing = false;
      if (this.currentPath.length > 1) {
        this.actions.push({ path: [...this.currentPath], color: this.currentColor });
        this.redoActions = [];
      }
      this.currentPath = [];
    }
  }
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'z') {
      this.undo();
    } else if (event.ctrlKey && event.key === 'y') {
      this.redo();
    }
  }

  private capturePoint(event: MouseEvent) {
    if (!this.canvasRef) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
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

  private redrawCanvas() {
    if (!this.ctx || !this.canvasRef) {
      return;
    }

    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw completed actions
    for (const action of this.actions) {
      this.drawPath(action.path, action.color);
    }

    // Draw current path if actively drawing
    if (this.isDrawing) {
      this.drawPath(this.currentPath, this.currentColor);
    }
  }

  private drawPath(path: { x: number; y: number }[], color: string) {
    if (path.length < 2) return;

    const canvas = this.canvasRef.nativeElement;
    this.ctx.beginPath();
    this.ctx.moveTo(path[0].x * canvas.width, path[0].y * canvas.height);
    for (let i = 1; i < path.length; i++) {
      this.ctx.lineTo(path[i].x * canvas.width, path[i].y * canvas.height);
    }
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.lineCap = 'round';
    this.ctx.stroke();
  }
  
}