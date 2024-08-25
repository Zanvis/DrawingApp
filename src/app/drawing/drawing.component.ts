import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { debounceTime, fromEvent, Subscription } from 'rxjs';

interface DrawAction {
  type: 'path' | 'image' | 'deleteImage' | 'addImage' | 'moveImage' | 'resizeImage' | 'rotateImage';
  path?: { x: number; y: number }[];
  color?: string;
  lineWidth?: number;
  isEraser?: boolean;
  image?: ImageElement;
  oldState?: Partial<ImageElement>;
  newState?: Partial<ImageElement>;
}
interface ImageElement {
  img: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
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
  private images: ImageElement[] = [];
  private selectedImage: ImageElement | null = null;
  private isDraggingImage = false;
  private isResizingImage = false;
  private isRotatingImage = false;
  private dragStartX = 0;
  private dragStartY = 0;


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

  @HostListener('document:dragover', ['$event'])
  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  @HostListener('document:drop', ['$event'])
  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleImageUpload(files[0]);
    }
  }

  handleImageUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const imageElement: ImageElement = {
          img,
          x: 0,
          y: 0,
          width: img.width,
          height: img.height,
          rotation: 0
        };
        this.images.push(imageElement);
        this.redrawCanvas();
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }
  onFileSelected(event: Event): void {
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleImageUpload(input.files[0]);
    }
  }
  
  onMouseDown(event: MouseEvent) {
    const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
    const clickedImage = this.getClickedImage(x, y);
  
    if (clickedImage) {
      this.selectedImage = clickedImage;
      if (this.isResizeHandle(x, y, clickedImage)) {
        this.isResizingImage = true;
      } else if (this.isRotateHandle(x, y, clickedImage)) {
        this.isRotatingImage = true;
      } else if (this.isDeleteHandle(x, y, clickedImage)) {
        this.deleteImage(clickedImage);
      } else {
        this.isDraggingImage = true;
        this.dragStartX = x - clickedImage.x / this.canvasRef.nativeElement.width;
        this.dragStartY = y - clickedImage.y / this.canvasRef.nativeElement.height;
      }
    } else {
      if (!this.isResizingImage && !this.isRotatingImage) {
        this.selectedImage = null;
      }
      if (this.isShiftPressed || this.isLineDrawingMode) {
        this.lineStartPoint = { x, y };
        this.isLineDrawingMode = true;
      } else {
        this.startDrawing(event.clientX, event.clientY);
      }
    }
    this.redrawCanvas();
  }
  private deleteImage(image: ImageElement) {
    const index = this.images.indexOf(image);
    if (index > -1) {
      this.images.splice(index, 1);
      this.actions.push({ type: 'deleteImage', image });
      this.redoActions = [];
      this.selectedImage = null;
      this.redrawCanvas();
    }
  }
  onMouseMove(event: MouseEvent) {
    const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
  
    if (this.selectedImage) {
      if (this.isResizingImage) {
        this.resizeSelectedImage(x, y);
      } else if (this.isRotatingImage) {
        this.rotateSelectedImage(x, y);
      } else if (this.isDraggingImage) {
        this.selectedImage.x = (x - this.dragStartX) * this.canvasRef.nativeElement.width;
        this.selectedImage.y = (y - this.dragStartY) * this.canvasRef.nativeElement.height;
      }
      this.redrawCanvas();
    } else if (this.isDrawing) {
      this.capturePoint(event.clientX, event.clientY);
      this.redrawCanvas();
    } else if (this.isLineDrawingMode && this.lineStartPoint) {
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
    this.isDraggingImage = false;
    this.isResizingImage = false;
    this.isRotatingImage = false;
    if (this.isLineDrawingMode && this.lineStartPoint) {
      const { x, y } = this.getCanvasCoordinates(event.clientX, event.clientY);
      const snappedEnd = this.getSnappedEndPoint(this.lineStartPoint, { x, y });
      this.actions.push({
        path: [this.lineStartPoint, snappedEnd],
        color: this.currentColor,
        lineWidth: this.brushSize,
        isEraser: false,
        type: 'path'
      });
      this.lineStartPoint = null;
      this.linePreview = null;
      this.isLineDrawingMode = false;
    } else {
      this.stopDrawing();
    }
    this.redrawCanvas();
  }
  private getClickedImage(x: number, y: number): ImageElement | null {
    const canvas = this.canvasRef.nativeElement;
    for (let i = this.images.length - 1; i >= 0; i--) {
      const img = this.images[i];
      const centerX = img.x + img.width / 2;
      const centerY = img.y + img.height / 2;
      const rotatedX = Math.cos(-img.rotation * Math.PI / 180) * (x * canvas.width - centerX) -
                       Math.sin(-img.rotation * Math.PI / 180) * (y * canvas.height - centerY) + centerX;
      const rotatedY = Math.sin(-img.rotation * Math.PI / 180) * (x * canvas.width - centerX) +
                       Math.cos(-img.rotation * Math.PI / 180) * (y * canvas.height - centerY) + centerY;
      
      if (
        rotatedX >= img.x &&
        rotatedX <= img.x + img.width &&
        rotatedY >= img.y &&
        rotatedY <= img.y + img.height
      ) {
        return img;
      }
    }
    return null;
  }
  onTouchStart(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const { x, y } = this.getCanvasCoordinates(touch.clientX, touch.clientY);
    const clickedImage = this.getClickedImage(x, y);
  
    if (clickedImage) {
      this.selectedImage = clickedImage;
      if (this.isResizeHandle(x, y, clickedImage)) {
        this.isResizingImage = true;
      } else if (this.isRotateHandle(x, y, clickedImage)) {
        this.isRotatingImage = true;
      } else if (this.isDeleteHandle(x, y, clickedImage)) {
        this.deleteImage(clickedImage);
      } else {
        this.isDraggingImage = true;
        this.dragStartX = x - clickedImage.x / this.canvasRef.nativeElement.width;
        this.dragStartY = y - clickedImage.y / this.canvasRef.nativeElement.height;
      }
    } else {
      if (!this.isResizingImage && !this.isRotatingImage) {
        this.selectedImage = null;
      }
      if (this.isShiftPressed || this.isLineDrawingMode) {
        this.lineStartPoint = { x, y };
        this.isLineDrawingMode = true;
      } else {
        this.startDrawing(touch.clientX, touch.clientY);
      }
    }
    this.redrawCanvas();
  }
  
  onTouchMove(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    const { x, y } = this.getCanvasCoordinates(touch.clientX, touch.clientY);
  
    if (this.selectedImage) {
      if (this.isResizingImage) {
        this.resizeSelectedImage(x, y);
      } else if (this.isRotatingImage) {
        this.rotateSelectedImage(x, y);
      } else if (this.isDraggingImage) {
        this.selectedImage.x = (x - this.dragStartX) * this.canvasRef.nativeElement.width;
        this.selectedImage.y = (y - this.dragStartY) * this.canvasRef.nativeElement.height;
      }
      this.redrawCanvas();
    } else if (this.isDrawing) {
      this.capturePoint(touch.clientX, touch.clientY);
      this.redrawCanvas();
    } else if (this.isLineDrawingMode && this.lineStartPoint) {
      const snappedEnd = this.getSnappedEndPoint(this.lineStartPoint, { x, y });
      this.linePreview = {
        start: this.lineStartPoint,
        end: snappedEnd
      };
      this.redrawCanvas();
    }
  
    if (this.isEraser) {
      this.drawEraserPreview(touch.clientX, touch.clientY);
    }
  }
  
  onTouchEnd(event: TouchEvent) {
    event.preventDefault();
    this.isDraggingImage = false;
    this.isResizingImage = false;
    this.isRotatingImage = false;
  
    if (this.isLineDrawingMode && this.lineStartPoint) {
      const { x, y } = this.getCanvasCoordinates(
        event.changedTouches[0].clientX,
        event.changedTouches[0].clientY
      );
      const snappedEnd = this.getSnappedEndPoint(this.lineStartPoint, { x, y });
      this.actions.push({
        path: [this.lineStartPoint, snappedEnd],
        color: this.currentColor,
        lineWidth: this.brushSize,
        isEraser: false,
        type: 'path'
      });
      this.lineStartPoint = null;
      this.linePreview = null;
      this.isLineDrawingMode = false;
    } else {
      this.stopDrawing();
    }
    this.redrawCanvas();
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
    if (event.key === 'Delete' && this.selectedImage) {
      this.deleteImage(this.selectedImage);
    }
    if (event.ctrlKey && event.key === 'c' && this.selectedImage) {
      this.duplicateImage();
    } else if (event.key === 'ArrowUp' && event.ctrlKey) {
      this.moveImageLayer('up');
    } else if (event.key === 'ArrowDown' && event.ctrlKey) {
      this.moveImageLayer('down');
    }
  }
  @HostListener('document:paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            this.handleImageUpload(blob);
          }
        }
      }
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
          isEraser: this.isEraser,
          type: 'path'
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
  
      switch (action.type) {
        case 'path':
          this.redrawCanvas();
          break;
        case 'addImage':
          if (action.image) {
            const index = this.images.indexOf(action.image);
            if (index > -1) {
              this.images.splice(index, 1);
            }
          }
          break;
        case 'deleteImage':
          if (action.image) {
            this.images.push(action.image);
          }
          break;
        case 'moveImage':
        case 'resizeImage':
        case 'rotateImage':
          if (action.image && action.oldState) {
            Object.assign(action.image, action.oldState);
          }
          break;
      }
  
      this.redrawCanvas();
    }
  }
  redo() {
    if (this.redoActions.length > 0) {
      const action = this.redoActions.pop()!;
      this.actions.push(action);
  
      switch (action.type) {
        case 'path':
          this.redrawCanvas();
          break;
        case 'addImage':
          if (action.image) {
            this.images.push(action.image);
          }
          break;
        case 'deleteImage':
          if (action.image) {
            const index = this.images.indexOf(action.image);
            if (index > -1) {
              this.images.splice(index, 1);
            }
          }
          break;
        case 'moveImage':
        case 'resizeImage':
        case 'rotateImage':
          if (action.image && action.newState) {
            Object.assign(action.image, action.newState);
          }
          break;
      }
  
      this.redrawCanvas();
    }
  }
  clearCanvas() {
    this.images.forEach((image) => {
      this.actions.push({
        type: 'deleteImage',
        image,
      });
    });
    this.images = [];
    this.actions = [];
    this.redoActions = [];
    this.selectedImage = null;
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
    for (const img of this.images) {
      this.drawRotatedImage(this.ctx, img);
    }
    // Create a temporary canvas for drawing actions
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;
  
    // Draw all actions on the temporary canvas
    for (const action of this.actions) {
      if (action.path) {
        this.drawPath(tempCtx, action.path, action.color || 'defaultColor', action.lineWidth || 1, action.isEraser!);
      }
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
  private isResizeHandle(x: number, y: number, image: ImageElement): boolean {
    const canvas = this.canvasRef.nativeElement;
    const handleSize = 16;
    const imageRight = (image.x + image.width) / canvas.width;
    const imageBottom = (image.y + image.height) / canvas.height;
    const centerX = (image.x + image.width / 2) / canvas.width;
    const centerY = (image.y + image.height / 2) / canvas.height;
    const rotatedX = Math.cos(-image.rotation * Math.PI / 180) * (x - centerX) -
                     Math.sin(-image.rotation * Math.PI / 180) * (y - centerY) + centerX;
    const rotatedY = Math.sin(-image.rotation * Math.PI / 180) * (x - centerX) +
                     Math.cos(-image.rotation * Math.PI / 180) * (y - centerY) + centerY;
    return (
      rotatedX >= imageRight - handleSize / canvas.width &&
      rotatedX <= imageRight + handleSize / canvas.width &&
      rotatedY >= imageBottom - handleSize / canvas.height &&
      rotatedY <= imageBottom + handleSize / canvas.height
    );
  }
  
  private isRotateHandle(x: number, y: number, image: ImageElement): boolean {
    const canvas = this.canvasRef.nativeElement;
    const handleSize = 30;
    const imageRight = (image.x + image.width) / canvas.width;
    const imageTop = image.y / canvas.height;
    const centerX = (image.x + image.width / 2) / canvas.width;
    const centerY = (image.y + image.height / 2) / canvas.height;
    const rotatedX = Math.cos(-image.rotation * Math.PI / 180) * (x - centerX) -
                     Math.sin(-image.rotation * Math.PI / 180) * (y - centerY) + centerX;
    const rotatedY = Math.sin(-image.rotation * Math.PI / 180) * (x - centerX) +
                     Math.cos(-image.rotation * Math.PI / 180) * (y - centerY) + centerY;
    return (
      rotatedX >= imageRight - handleSize / canvas.width &&
      rotatedX <= imageRight + handleSize / canvas.width &&
      rotatedY >= imageTop - handleSize / canvas.height &&
      rotatedY <= imageTop + handleSize / canvas.height
    );
  }
  
  private isDeleteHandle(x: number, y: number, image: ImageElement): boolean {
    const canvas = this.canvasRef.nativeElement;
    const handleSize = 16;
    const imageLeft = image.x / canvas.width;
    const imageTop = image.y / canvas.height;
    const centerX = (image.x + image.width / 2) / canvas.width;
    const centerY = (image.y + image.height / 2) / canvas.height;
    const rotatedX = Math.cos(-image.rotation * Math.PI / 180) * (x - centerX) -
                     Math.sin(-image.rotation * Math.PI / 180) * (y - centerY) + centerX;
    const rotatedY = Math.sin(-image.rotation * Math.PI / 180) * (x - centerX) +
                     Math.cos(-image.rotation * Math.PI / 180) * (y - centerY) + centerY;
    return (
      rotatedX >= imageLeft - handleSize / canvas.width &&
      rotatedX <= imageLeft + handleSize / canvas.width &&
      rotatedY >= imageTop - handleSize / canvas.height &&
      rotatedY <= imageTop + handleSize / canvas.height
    );
  }
  private resizeSelectedImage(x: number, y: number) {
    if (this.selectedImage) {
      const canvas = this.canvasRef.nativeElement;
      const oldState = { width: this.selectedImage.width, height: this.selectedImage.height };
      const newWidth = (x * canvas.width) - this.selectedImage.x;
      const aspectRatio = this.selectedImage.width / this.selectedImage.height;
      const newHeight = newWidth / aspectRatio;
  
      if (newWidth > 20 && newHeight > 20) {
        this.selectedImage.width = newWidth;
        this.selectedImage.height = newHeight;
        this.actions.push({
          type: 'resizeImage',
          image: this.selectedImage,
          oldState,
          newState: { width: newWidth, height: newHeight }
        });
        this.redoActions = [];
      }
    }
  }
  
  private rotateSelectedImage(x: number, y: number) {
    if (this.selectedImage) {
      const canvas = this.canvasRef.nativeElement;
      const centerX = this.selectedImage.x + this.selectedImage.width / 2;
      const centerY = this.selectedImage.y + this.selectedImage.height / 2;
      const oldRotation = this.selectedImage.rotation;
      const angle = Math.atan2((y * canvas.height) - centerY, (x * canvas.width) - centerX);
      const newRotation = angle * (180 / Math.PI);
      this.selectedImage.rotation = newRotation;
      this.actions.push({
        type: 'rotateImage',
        image: this.selectedImage,
        oldState: { rotation: oldRotation },
        newState: { rotation: newRotation }
      });
      this.redoActions = [];
    }
  }
  
  private drawRotatedImage(ctx: CanvasRenderingContext2D, imageElement: ImageElement) {
    ctx.save();
    ctx.translate(imageElement.x + imageElement.width / 2, imageElement.y + imageElement.height / 2);
    ctx.rotate(imageElement.rotation * Math.PI / 180);
    ctx.drawImage(
      imageElement.img,
      -imageElement.width / 2,
      -imageElement.height / 2,
      imageElement.width,
      imageElement.height
    );
  
    if (this.selectedImage === imageElement) {
      // Draw border
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 2;
      ctx.strokeRect(-imageElement.width / 2, -imageElement.height / 2, imageElement.width, imageElement.height);
  
      // Resize handle (bottom-right corner)
      ctx.fillStyle = 'blue';
      ctx.beginPath();
      ctx.arc(imageElement.width / 2, imageElement.height / 2, 8, 0, 2 * Math.PI);
      ctx.fill();
  
      // Rotate indicator (top-right corner)
      ctx.beginPath();
      ctx.moveTo(imageElement.width / 2 - 15, -imageElement.height / 2);
      ctx.lineTo(imageElement.width / 2, -imageElement.height / 2 - 15);
      ctx.lineTo(imageElement.width / 2 + 15, -imageElement.height / 2);
      ctx.closePath();
      ctx.fill();
  
      // Delete button (top-left corner)
      ctx.fillStyle = 'red';
      ctx.beginPath();
      ctx.arc(-imageElement.width / 2, -imageElement.height / 2, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.fillText('X', -imageElement.width / 2 - 4, -imageElement.height / 2 + 4);
    }
  
    ctx.restore();
  }
  flipImage(horizontal: boolean = true) {
    if (this.selectedImage) {
      const oldState = { width: this.selectedImage.width, height: this.selectedImage.height };
      if (horizontal) {
        this.selectedImage.width = -this.selectedImage.width;
      } else {
        this.selectedImage.height = -this.selectedImage.height;
      }
      this.actions.push({
        type: 'resizeImage',
        image: this.selectedImage,
        oldState,
        newState: { width: this.selectedImage.width, height: this.selectedImage.height }
      });
      this.redoActions = [];
      this.redrawCanvas();
    }
  }
  moveImageLayer(direction: 'up' | 'down') {
    if (this.selectedImage) {
      const index = this.images.indexOf(this.selectedImage);
      if (direction === 'up' && index < this.images.length - 1) {
        [this.images[index], this.images[index + 1]] = [this.images[index + 1], this.images[index]];
      } else if (direction === 'down' && index > 0) {
        [this.images[index], this.images[index - 1]] = [this.images[index - 1], this.images[index]];
      }
      this.redrawCanvas();
    }
  }
  duplicateImage() {
    if (this.selectedImage) {
      const newImage: ImageElement = {
        ...this.selectedImage,
        x: this.selectedImage.x + 20,
        y: this.selectedImage.y + 20
      };
      this.images.push(newImage);
      this.actions.push({
        type: 'addImage',
        image: newImage
      });
      this.redoActions = [];
      this.redrawCanvas();
    }
  }
}