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

  summary = signal({'title': '', 'bullets': [], 'summary': ''});
  loading = signal('');
  videoUrl = '';


  /**
   *
   */
  constructor(private httpClient: HttpClient) {}

  clickSummarize() {

    this.loading.set("Please wait! I am preparing the summary of the youtube video...")
    this.summary.set({'title': '', 'bullets': [], 'summary': ''});

    this.httpClient
      .post('http://localhost:8080/api/summarize', { "data": {'urlOrId': this.videoUrl} })
      .subscribe({
        next: (response: any) => {
          const r = response?.result
          this.summary.set({'title': r?.title, 'bullets': r?.bullets, 'summary': r?.summary});

          this.loading.set('');
        },
        error: (error) => {
          console.error('There was an error!', error);
          this.loading.set('');
        },
        complete: () => {
          //this.summary = 'This is a dummy summary. Replace this with actual summary from backend.';
        },
      });
  }
}
