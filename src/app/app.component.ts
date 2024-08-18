import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DrawingComponent } from './drawing/drawing.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DrawingComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'DrawingApp';
}
