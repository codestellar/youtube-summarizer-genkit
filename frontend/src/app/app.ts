import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

export interface Summary {
  title: string;
  bullets: string[];
  summary: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('frontend');

  summary = signal({'title': '', 'bullets': ['No summary'], 'summary': 'No Summary yet'});
  mySummary : any;
  videoUrl = '';


  /**
   *
   */
  constructor(private httpClient: HttpClient) {}

  clickSummarize() {

    this.httpClient
      .post('http://localhost:8080/api/summarize', { "data": {'urlOrId': this.videoUrl} })
      .subscribe({
        next: (response: any) => {
          const r = response?.result
          this.summary.set({'title': r?.title, 'bullets': r?.bullets, 'summary': r?.summary});

          //this.mySummary = response?.bullets;
        },
        error: (error) => {
          console.error('There was an error!', error);
        },
        complete: () => {
          //this.summary = 'This is a dummy summary. Replace this with actual summary from backend.';
        },
      });
  }
}
